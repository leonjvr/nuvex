use anyhow::{Context, Result};
use enigo::{Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings};
use serde_json::Value;

fn parse_key(s: &str) -> Key {
    match s.to_lowercase().as_str() {
        "ctrl" | "control" => Key::Control,
        "alt" => Key::Alt,
        "shift" => Key::Shift,
        "win" | "meta" | "super" => Key::Meta,
        "enter" | "return" => Key::Return,
        "tab" => Key::Tab,
        "esc" | "escape" => Key::Escape,
        "backspace" => Key::Backspace,
        "delete" => Key::Delete,
        "home" => Key::Home,
        "end" => Key::End,
        "pageup" => Key::PageUp,
        "pagedown" => Key::PageDown,
        "up" => Key::UpArrow,
        "down" => Key::DownArrow,
        "left" => Key::LeftArrow,
        "right" => Key::RightArrow,
        "f1" => Key::F1,
        "f2" => Key::F2,
        "f3" => Key::F3,
        "f4" => Key::F4,
        "f5" => Key::F5,
        "f6" => Key::F6,
        "f7" => Key::F7,
        "f8" => Key::F8,
        "f9" => Key::F9,
        "f10" => Key::F10,
        "f11" => Key::F11,
        "f12" => Key::F12,
        s if s.len() == 1 => Key::Unicode(s.chars().next().unwrap()),
        _ => Key::Unicode(s.chars().next().unwrap_or(' ')),
    }
}

/// desktop_type_text — types the given text.
/// Args: { "text": str, "interval": float (ignored, kept for compat) }
pub fn type_text(args: Value) -> Result<Value> {
    let text = args.get("text")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let mut enigo = Enigo::new(&Settings::default())
        .context("Failed to initialise Enigo")?;

    enigo.text(text).context("Failed to type text")?;

    Ok(serde_json::json!({
        "typed": true,
        "length": text.len()
    }))
}

/// desktop_hotkey — sends a key combination.
/// Args: { "keys": ["ctrl", "c"] }
pub fn hotkey(args: Value) -> Result<Value> {
    let keys: Vec<String> = args.get("keys")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter()
            .filter_map(|k| k.as_str().map(|s| s.to_string()))
            .collect())
        .unwrap_or_default();

    if keys.is_empty() {
        return Ok(serde_json::json!({"sent": false, "keys": []}));
    }

    let mut enigo = Enigo::new(&Settings::default())
        .context("Failed to initialise Enigo")?;

    // Press all keys down
    for k in &keys {
        enigo.key(parse_key(k), Direction::Press)
            .with_context(|| format!("Failed to press key: {}", k))?;
    }
    // Release in reverse
    for k in keys.iter().rev() {
        enigo.key(parse_key(k), Direction::Release)
            .with_context(|| format!("Failed to release key: {}", k))?;
    }

    Ok(serde_json::json!({"sent": true, "keys": keys}))
}

/// desktop_mouse_click — clicks at absolute screen coordinates.
/// Args: { "x": int, "y": int, "button": "left"|"right"|"middle" }
pub fn mouse_click(args: Value) -> Result<Value> {
    let x = args.get("x").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
    let y = args.get("y").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
    let button_str = args.get("button").and_then(|v| v.as_str()).unwrap_or("left");

    let button = match button_str {
        "right" => Button::Right,
        "middle" => Button::Middle,
        _ => Button::Left,
    };

    let mut enigo = Enigo::new(&Settings::default())
        .context("Failed to initialise Enigo")?;

    enigo.move_mouse(x, y, Coordinate::Abs)
        .context("Failed to move mouse")?;
    enigo.button(button, Direction::Click)
        .context("Failed to click mouse button")?;

    Ok(serde_json::json!({"clicked": true, "x": x, "y": y}))
}
