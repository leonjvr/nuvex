use anyhow::{Context, Result};
use arboard::Clipboard;
use serde_json::Value;

/// desktop_get_clipboard — returns the current clipboard text.
pub fn get_clipboard(_args: Value) -> Result<Value> {
    let mut cb = Clipboard::new().context("Failed to open clipboard")?;
    let text = cb.get_text().context("Failed to read clipboard text")?;
    Ok(serde_json::json!({"content": text}))
}

/// desktop_set_clipboard — writes text to the clipboard.
/// Args: { "text": str }
pub fn set_clipboard(args: Value) -> Result<Value> {
    let text = args.get("text")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let mut cb = Clipboard::new().context("Failed to open clipboard")?;
    cb.set_text(text).context("Failed to set clipboard text")?;
    Ok(serde_json::json!({"set": true}))
}
