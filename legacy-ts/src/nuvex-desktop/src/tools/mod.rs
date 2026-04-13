use anyhow::Result;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

pub mod clipboard;
pub mod input;
pub mod screen;
pub mod shell;

pub type ToolFn = Arc<dyn Fn(Value) -> Result<Value> + Send + Sync>;

/// Build the registry of all supported tools.
pub fn build_registry() -> HashMap<String, ToolFn> {
    let mut map: HashMap<String, ToolFn> = HashMap::new();

    map.insert("desktop_screenshot".into(), Arc::new(screen::screenshot));
    map.insert("desktop_type_text".into(), Arc::new(input::type_text));
    map.insert("desktop_hotkey".into(), Arc::new(input::hotkey));
    map.insert("desktop_mouse_click".into(), Arc::new(input::mouse_click));
    map.insert("desktop_get_clipboard".into(), Arc::new(clipboard::get_clipboard));
    map.insert("desktop_set_clipboard".into(), Arc::new(clipboard::set_clipboard));
    map.insert("desktop_run_app".into(), Arc::new(shell::run_app));
    map.insert("desktop_shell".into(), Arc::new(shell::shell_exec));

    // UIA tools — not available in v1
    for name in &[
        "desktop_list_windows",
        "desktop_find_control",
        "desktop_click_control",
        "desktop_get_control_text",
    ] {
        let n = name.to_string();
        map.insert(
            n.clone(),
            Arc::new(move |_args: Value| -> Result<Value> {
                Ok(serde_json::json!({
                    "error": format!("{} is not available in this version", n),
                    "category": "not_available"
                }))
            }),
        );
    }

    // Outlook tools — not available in v1
    for name in &[
        "desktop_outlook_get_emails",
        "desktop_outlook_send_email",
        "desktop_outlook_reply",
        "desktop_outlook_move",
    ] {
        let n = name.to_string();
        map.insert(
            n.clone(),
            Arc::new(move |_args: Value| -> Result<Value> {
                Ok(serde_json::json!({
                    "error": format!("{} is not available in this version", n),
                    "category": "not_available"
                }))
            }),
        );
    }

    map
}
