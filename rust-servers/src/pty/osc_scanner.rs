// OSC 133/633 scanner
// Parses Shell Integration sequences, including across data chunks

#[derive(Debug, Clone, Copy)]
pub enum OscSource {
    Osc133,
    Osc633,
}

#[derive(Debug, Clone)]
pub enum OscEvent {
    PromptStart { source: OscSource },
    CommandStart { source: OscSource },
    CommandExecuted { source: OscSource },
    CommandEnd { source: OscSource, exit_code: Option<i32> },
}

impl OscEvent {
    pub fn event_name(&self) -> &'static str {
        match self {
            OscEvent::PromptStart { .. } => "prompt_start",
            OscEvent::CommandStart { .. } => "command_start",
            OscEvent::CommandExecuted { .. } => "command_executed",
            OscEvent::CommandEnd { .. } => "command_end",
        }
    }

    pub fn source_name(&self) -> &'static str {
        match self {
            OscEvent::PromptStart { source }
            | OscEvent::CommandStart { source }
            | OscEvent::CommandExecuted { source }
            | OscEvent::CommandEnd { source, .. } => match source {
                OscSource::Osc133 => "osc133",
                OscSource::Osc633 => "osc633",
            },
        }
    }

    pub fn exit_code(&self) -> Option<i32> {
        match self {
            OscEvent::CommandEnd { exit_code, .. } => *exit_code,
            _ => None,
        }
    }
}

#[derive(Debug)]
pub struct OscScanner {
    buffer: Vec<u8>,
    max_buffer: usize,
}

impl OscScanner {
    pub fn new() -> Self {
        Self {
            buffer: Vec::new(),
            max_buffer: 8192,
        }
    }

    pub fn scan(&mut self, data: &[u8]) -> Vec<OscEvent> {
        self.buffer.extend_from_slice(data);

        let mut events = Vec::new();
        let mut index = 0;
        let len = self.buffer.len();

        while index + 1 < len {
            if self.buffer[index] == 0x1b && self.buffer[index + 1] == b']' {
                match self.parse_sequence(index) {
                    ParseResult::Parsed { next_index, event } => {
                        if let Some(event) = event {
                            events.push(event);
                        }
                        index = next_index;
                        continue;
                    }
                    ParseResult::Incomplete => break,
                    ParseResult::Invalid => {
                        index += 1;
                        continue;
                    }
                }
            }
            index += 1;
        }

        if index > 0 {
            self.buffer.drain(0..index);
        }

        if self.buffer.len() > self.max_buffer {
            let keep_from = self.buffer.len().saturating_sub(self.max_buffer);
            self.buffer.drain(0..keep_from);
        }

        events
    }

    fn parse_sequence(&self, start: usize) -> ParseResult {
        let len = self.buffer.len();
        if start + 2 >= len {
            return ParseResult::Incomplete;
        }

        let mut code_end = None;
        let mut i = start + 2;
        while i < len {
            let b = self.buffer[i];
            if b == b';' {
                code_end = Some(i);
                break;
            }
            if !b.is_ascii_digit() {
                return ParseResult::Invalid;
            }
            i += 1;
        }

        let code_end = match code_end {
            Some(end) => end,
            None => return ParseResult::Incomplete,
        };

        let code = match std::str::from_utf8(&self.buffer[start + 2..code_end]) {
            Ok(value) => value,
            Err(_) => return ParseResult::Invalid,
        };

        let mut terminator_start = None;
        let mut terminator_len = 0;
        let mut j = code_end + 1;
        while j < len {
            let b = self.buffer[j];
            if b == 0x07 {
                terminator_start = Some(j);
                terminator_len = 1;
                break;
            }
            if b == 0x1b {
                if j + 1 < len && self.buffer[j + 1] == b'\\' {
                    terminator_start = Some(j);
                    terminator_len = 2;
                    break;
                }
            }
            j += 1;
        }

        let terminator_start = match terminator_start {
            Some(pos) => pos,
            None => return ParseResult::Incomplete,
        };

        let payload = &self.buffer[code_end + 1..terminator_start];
        let event = Self::parse_payload(code, payload);

        ParseResult::Parsed {
            next_index: terminator_start + terminator_len,
            event,
        }
    }

    fn parse_payload(code: &str, payload: &[u8]) -> Option<OscEvent> {
        let source = match code {
            "133" => OscSource::Osc133,
            "633" => OscSource::Osc633,
            _ => return None,
        };

        if payload.is_empty() {
            return None;
        }

        let mut parts = payload.split(|b| *b == b';');
        let marker = parts.next()?;

        match marker {
            b"A" => Some(OscEvent::PromptStart { source }),
            b"B" => Some(OscEvent::CommandStart { source }),
            b"C" => Some(OscEvent::CommandExecuted { source }),
            b"D" => {
                let exit_code = parts
                    .next()
                    .and_then(|value| std::str::from_utf8(value).ok())
                    .and_then(|value| value.parse::<i32>().ok());
                Some(OscEvent::CommandEnd { source, exit_code })
            }
            _ => None,
        }
    }
}

enum ParseResult {
    Parsed { next_index: usize, event: Option<OscEvent> },
    Incomplete,
    Invalid,
}
