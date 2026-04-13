use anyhow::{Context, Result};
use serde_json::Value;
use std::process::Command;
use std::time::Duration;

/// desktop_run_app — launches an executable.
/// Args: { "executable": str, "args": [str] }
pub fn run_app(args: Value) -> Result<Value> {
    let executable = args.get("executable")
        .and_then(|v| v.as_str())
        .context("Missing 'executable' argument")?;

    let extra_args: Vec<String> = args.get("args")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter()
            .filter_map(|a| a.as_str().map(|s| s.to_string()))
            .collect())
        .unwrap_or_default();

    let child = Command::new(executable)
        .args(&extra_args)
        .spawn()
        .with_context(|| format!("Failed to launch '{}'", executable))?;

    let pid = child.id();
    Ok(serde_json::json!({"pid": pid, "started": true}))
}

/// desktop_shell — runs a shell command and waits for it.
/// Args: { "command": str, "timeout": int (seconds) }
pub fn shell_exec(args: Value) -> Result<Value> {
    let command = args.get("command")
        .and_then(|v| v.as_str())
        .context("Missing 'command' argument")?;

    let timeout_secs = args.get("timeout")
        .and_then(|v| v.as_u64())
        .unwrap_or(30);

    #[cfg(target_os = "windows")]
    let mut child = Command::new("cmd")
        .args(["/C", command])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .context("Failed to spawn cmd")?;

    #[cfg(not(target_os = "windows"))]
    let mut child = Command::new("sh")
        .args(["-c", command])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .context("Failed to spawn sh")?;

    // Simple timeout: poll every 100ms
    let timeout = Duration::from_secs(timeout_secs);
    let start = std::time::Instant::now();
    let exit_status = loop {
        match child.try_wait().context("Failed to check process status")? {
            Some(status) => break status,
            None if start.elapsed() >= timeout => {
                let _ = child.kill();
                return Ok(serde_json::json!({
                    "stdout": "",
                    "stderr": "Command timed out",
                    "exit_code": -1
                }));
            }
            None => std::thread::sleep(Duration::from_millis(100)),
        }
    };

    let output = child.wait_with_output().context("Failed to capture output")?;
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    let exit_code = exit_status.code().unwrap_or(-1);

    Ok(serde_json::json!({
        "stdout": stdout,
        "stderr": stderr,
        "exit_code": exit_code
    }))
}
