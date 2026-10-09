use std::fmt;
use std::io::{self, Write};
use std::sync::atomic::{AtomicUsize, Ordering};

static FAILED_LOG_WRITES: AtomicUsize = AtomicUsize::new(0);

/// Keep diagnostic I/O failures from aborting the PTY server.
pub fn write_line(arguments: fmt::Arguments<'_>) {
    let mut stderr = io::stderr().lock();
    if writeln!(stderr, "{}", arguments).is_err() {
        FAILED_LOG_WRITES.fetch_add(1, Ordering::Relaxed);
        return;
    }

    // Report lost diagnostics when stderr becomes writable again. This must
    // use the same fallible writer, never a recursive eprintln! call.
    let failures = FAILED_LOG_WRITES.swap(0, Ordering::Relaxed);
    if failures > 0
        && writeln!(
            stderr,
            "[WARN] [Logging] stderr output recovered after {} failed log writes",
            failures
        )
        .is_err()
    {
        FAILED_LOG_WRITES.fetch_add(failures, Ordering::Relaxed);
    }
}
