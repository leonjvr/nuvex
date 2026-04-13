use crate::tools::{build_registry, ToolFn};
use anyhow::Result;
use serde_json::Value;
use std::collections::HashMap;

pub struct Dispatcher {
    registry: HashMap<String, ToolFn>,
}

impl Dispatcher {
    pub fn new() -> Self {
        Self {
            registry: build_registry(),
        }
    }

    /// Dispatch a tool call. Returns (result_json, is_error, category).
    pub fn dispatch(&self, tool: &str, args: Value) -> (Value, bool, Option<String>) {
        match self.registry.get(tool) {
            None => {
                let msg = format!("Unknown tool: {}", tool);
                (Value::String(msg), true, Some("not_available".into()))
            }
            Some(func) => match func(args) {
                Ok(result) => {
                    // Check if the tool returned a not_available sentinel
                    if result.get("category").and_then(|v| v.as_str()) == Some("not_available") {
                        let err = result.get("error")
                            .and_then(|v| v.as_str())
                            .unwrap_or("not available")
                            .to_string();
                        (Value::String(err), true, Some("not_available".into()))
                    } else {
                        (result, false, None)
                    }
                }
                Err(e) => {
                    let msg = format!("{:#}", e);
                    (Value::String(msg), true, Some("unknown".into()))
                }
            },
        }
    }
}

impl Default for Dispatcher {
    fn default() -> Self {
        Self::new()
    }
}
