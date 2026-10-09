#![cfg(unix)]

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::error::Error;
use std::io::{self, BufRead, BufReader, Read};
use std::os::fd::OwnedFd;
use std::os::unix::net::UnixStream;
use std::os::unix::process::ExitStatusExt;
use std::process::{Child, ChildStderr, Command, Stdio};
use std::sync::mpsc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use tokio::time::timeout;
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;
type Client = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;
const TIMEOUT: Duration = Duration::from_secs(5);

fn disconnected_output() -> io::Result<Stdio> {
    let (reader, writer) = UnixStream::pair()?;
    drop(reader);
    Ok(Stdio::from(OwnedFd::from(writer)))
}

enum StderrMode {
    Read,
    CloseBeforeStartup,
    CloseAfterStartup,
    #[cfg(target_os = "linux")]
    Full,
    #[cfg(target_os = "linux")]
    Nonblocking,
}

struct ServerProcess {
    child: Child,
    port: u16,
    stderr: Option<ChildStderr>,
    log_reader: Option<JoinHandle<io::Result<Vec<u8>>>>,
}

impl ServerProcess {
    fn start(mode: StderrMode) -> TestResult<Self> {
        let mut command = Command::new(env!("CARGO_BIN_EXE_termy-server"));
        command
            .args(["--port", "0"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if matches!(mode, StderrMode::CloseBeforeStartup) {
            command.stderr(disconnected_output()?);
        }

        #[cfg(target_os = "linux")]
        match mode {
            StderrMode::Full => {
                command.stderr(std::fs::OpenOptions::new().write(true).open("/dev/full")?);
            }
            StderrMode::Nonblocking => {
                use std::os::unix::process::CommandExt;
                // Only async-signal-safe syscalls run between fork and exec.
                unsafe {
                    command.pre_exec(|| {
                        let flags = libc::fcntl(2, libc::F_GETFL);
                        if flags == -1
                            || libc::fcntl(2, libc::F_SETFL, flags | libc::O_NONBLOCK) == -1
                            || libc::fcntl(2, libc::F_SETPIPE_SZ, 4096) == -1
                        {
                            return Err(io::Error::last_os_error());
                        }
                        Ok(())
                    });
                }
            }
            _ => {}
        }

        let child = command.spawn()?;
        let mut server = Self {
            child,
            port: 0,
            stderr: None,
            log_reader: None,
        };
        server.stderr = server.child.stderr.take();
        if matches!(mode, StderrMode::Read) {
            server.read_logs();
        }

        let stdout = server.child.stdout.take().ok_or("missing stdout pipe")?;
        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || {
            let mut line = String::new();
            let result = BufReader::new(stdout).read_line(&mut line).map(|_| line);
            let _ = sender.send(result);
        });
        let line = receiver.recv_timeout(TIMEOUT)??;
        let info: Value = serde_json::from_str(&line)?;
        server.port = info["port"]
            .as_u64()
            .and_then(|port| u16::try_from(port).ok())
            .filter(|port| *port > 0)
            .ok_or("missing server port")?;
        if matches!(mode, StderrMode::CloseAfterStartup) {
            drop(server.stderr.take());
        }
        Ok(server)
    }

    fn read_logs(&mut self) {
        if let Some(mut stderr) = self.stderr.take() {
            self.log_reader = Some(thread::spawn(move || {
                let mut logs = Vec::new();
                stderr.read_to_end(&mut logs)?;
                Ok(logs)
            }));
        }
    }

    fn assert_running(&mut self) -> TestResult {
        assert!(
            self.child.try_wait()?.is_none(),
            "backend exited unexpectedly"
        );
        Ok(())
    }

    fn stop(&mut self) -> TestResult<String> {
        self.assert_running()?;
        self.child.kill()?;
        self.child.wait()?;
        let logs = match self.log_reader.take() {
            Some(reader) => reader.join().expect("log reader panicked")?,
            None => Vec::new(),
        };
        Ok(String::from_utf8_lossy(&logs).into_owned())
    }
}

impl Drop for ServerProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        if let Some(reader) = self.log_reader.take() {
            let _ = reader.join();
        }
    }
}

async fn connect(server: &ServerProcess) -> TestResult<Client> {
    let (client, _) = timeout(
        TIMEOUT,
        connect_async(format!("ws://127.0.0.1:{}", server.port)),
    )
    .await??;
    Ok(client)
}

async fn next_message(client: &mut Client) -> TestResult<Message> {
    Ok(timeout(TIMEOUT, client.next())
        .await?
        .ok_or("WebSocket closed unexpectedly")??)
}

async fn exercise_pty(client: &mut Client) -> TestResult {
    client.send(Message::Text("invalid JSON".into())).await?;
    let Message::Text(error) = next_message(client).await? else {
        return Err("expected parse error response".into());
    };
    assert_eq!(
        serde_json::from_str::<Value>(&error)?["code"],
        "PARSE_ERROR"
    );

    client.send(Message::Text(json!({
        "module": "pty", "type": "init", "shell_type": "custom:/bin/sh", "shell_args": ["-i"],
        "cwd": std::env::temp_dir(), "cols": 80, "rows": 24,
        "env": {"LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "LC_CTYPE": "C.UTF-8"}
    }).to_string().into())).await?;
    let Message::Text(init) = next_message(client).await? else {
        return Err("expected init response".into());
    };
    let init: Value = serde_json::from_str(&init)?;
    assert_eq!(init["type"], "init_complete");
    assert_eq!(init["success"], true);
    let session = init["session_id"].as_str().ok_or("missing session ID")?;
    client
        .send(Message::Text(
            json!({
                "module": "pty", "type": "resize", "session_id": session, "cols": 120, "rows": 40
            })
            .to_string()
            .into(),
        ))
        .await?;

    let mut input = vec![u8::try_from(session.len())?];
    input.extend_from_slice(session.as_bytes());
    input.extend_from_slice(b"printf 'stdio-regression-output\\n'; exit 0\n");
    client.send(Message::Binary(input.into())).await?;
    let mut output = Vec::new();
    loop {
        match next_message(client).await? {
            Message::Binary(data) => {
                let id_len = usize::from(*data.first().ok_or("empty binary frame")?);
                assert_eq!(data.get(1..1 + id_len), Some(session.as_bytes()));
                output.extend_from_slice(&data[1 + id_len..]);
            }
            Message::Text(text) => {
                let message: Value = serde_json::from_str(&text)?;
                assert_eq!(message["type"], "exit");
                assert_eq!(message["session_id"], session);
                break;
            }
            message => return Err(format!("unexpected WebSocket message: {message:?}").into()),
        }
    }
    // Match command output on its own line, so terminal input echo cannot satisfy the assertion.
    assert!(
        output
            .windows(b"\r\nstdio-regression-output\r\n".len())
            .any(|line| line == b"\r\nstdio-regression-output\r\n"),
        "shell output missing"
    );
    client
        .send(Message::Text(
            json!({
                "module": "pty", "type": "destroy", "session_id": session
            })
            .to_string()
            .into(),
        ))
        .await?;
    client.close(None).await?;
    Ok(())
}

#[tokio::test]
async fn writable_stderr_preserves_logs_and_pty_output() -> TestResult {
    let mut server = ServerProcess::start(StderrMode::Read)?;
    exercise_pty(&mut connect(&server).await?).await?;
    let logs = server.stop()?;
    assert!(logs.contains("[INFO] WebSocket 连接已建立"));
    assert!(logs.contains("[INFO] [PTY] PTY 会话创建成功"));
    assert!(!logs.contains("panicked at"));
    Ok(())
}

#[tokio::test]
async fn closed_stderr_before_startup_keeps_pty_working() -> TestResult {
    let mut server = ServerProcess::start(StderrMode::CloseBeforeStartup)?;
    exercise_pty(&mut connect(&server).await?).await?;
    server.assert_running()
}

#[tokio::test]
async fn closed_stderr_after_startup_keeps_pty_working() -> TestResult {
    let mut server = ServerProcess::start(StderrMode::CloseAfterStartup)?;
    exercise_pty(&mut connect(&server).await?).await?;
    server.assert_running()
}

#[cfg(target_os = "linux")]
#[tokio::test]
async fn full_stderr_keeps_pty_working() -> TestResult {
    let mut server = ServerProcess::start(StderrMode::Full)?;
    exercise_pty(&mut connect(&server).await?).await?;
    server.assert_running()
}

#[cfg(target_os = "linux")]
#[tokio::test]
async fn nonblocking_stderr_recovers_and_reports_lost_logs() -> TestResult {
    let mut server = ServerProcess::start(StderrMode::Nonblocking)?;
    let mut client = connect(&server).await?;
    // Fill the real nonblocking pipe while deliberately withholding its reader.
    for _ in 0..100 {
        client.send(Message::Text("invalid JSON".into())).await?;
        let Message::Text(error) = next_message(&mut client).await? else {
            return Err("expected parse error response".into());
        };
        assert_eq!(
            serde_json::from_str::<Value>(&error)?["code"],
            "PARSE_ERROR"
        );
    }
    server.assert_running()?;
    server.read_logs();
    exercise_pty(&mut client).await?;
    let logs = server.stop()?;
    let (_, recovery) = logs
        .split_once("[WARN] [Logging] stderr output recovered after ")
        .ok_or("missing recovery diagnostic")?;
    let failures: usize = recovery
        .split_whitespace()
        .next()
        .ok_or("missing lost-log count")?
        .parse()?;
    assert!(failures > 0, "stderr failures must be reported");
    Ok(())
}

#[test]
fn closed_startup_stdout_returns_error_without_aborting() -> TestResult {
    let mut child = Command::new(env!("CARGO_BIN_EXE_termy-server"))
        .args(["--port", "0"])
        .stdout(disconnected_output()?)
        .stderr(Stdio::null())
        .spawn()?;
    let deadline = Instant::now() + TIMEOUT;
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if Instant::now() >= deadline {
            child.kill()?;
            child.wait()?;
            return Err("backend did not report startup output failure".into());
        }
        thread::sleep(Duration::from_millis(10));
    };
    assert!(!status.success());
    assert_eq!(
        status.signal(),
        None,
        "backend should return a startup error, not abort"
    );
    Ok(())
}
