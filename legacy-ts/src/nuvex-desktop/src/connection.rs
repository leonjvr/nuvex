use crate::config::Config;
use crate::dispatcher::Dispatcher;
use crate::tray::TrayMsg;
use crate::updater;
use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc as async_mpsc;
use tokio_tungstenite::tungstenite::Message;
use tracing::{error, info, warn};

const INITIAL_BACKOFF: Duration = Duration::from_secs(2);
const MAX_BACKOFF: Duration = Duration::from_secs(60);

/// Register this device with the brain and persist the device_id.
pub async fn register_device(cfg: &mut Config) -> Result<()> {
    let client = reqwest::Client::new();
    let url = format!(
        "{}/devices/register",
        cfg.brain_url.trim_end_matches('/')
    );

    let resp = client
        .post(&url)
        .json(&json!({
            "token": cfg.auth_token,
            "device_name": cfg.device_name,
            "platform": std::env::consts::OS
        }))
        .send()
        .await
        .context("HTTP POST to /devices/register failed")?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("Registration failed ({}): {}", status, body);
    }

    let body: Value = resp.json().await.context("Failed to parse registration response")?;
    let device_id = body
        .get("device_id")
        .and_then(|v| v.as_str())
        .context("Missing device_id in registration response")?
        .to_string();

    cfg.device_id = Some(device_id);
    cfg.save().context("Failed to save config after registration")?;
    info!("Registered as device_id={}", cfg.device_id.as_deref().unwrap_or("?"));
    Ok(())
}

/// Main reconnect loop. Runs until quit_flag is set.
pub async fn connect_loop(
    mut cfg: Config,
    quit: Arc<AtomicBool>,
    tray_tx: std::sync::mpsc::Sender<TrayMsg>,
    reconnect_rx: std::sync::mpsc::Receiver<Config>,
) {
    let dispatcher = Arc::new(Dispatcher::new());
    let mut backoff = INITIAL_BACKOFF;
    let update_checking = Arc::new(AtomicBool::new(false));
    let mut update_checked_once = false;

    loop {
        if quit.load(Ordering::Relaxed) {
            break;
        }

        // Apply any config update saved from the settings window
        while let Ok(new_cfg) = reconnect_rx.try_recv() {
            info!("Config updated via settings — reconnecting");
            let _ = tray_tx.send(TrayMsg::ConfigChanged(new_cfg.brain_url.clone()));
            cfg = new_cfg;
        }

        // Ensure we have a device_id
        if cfg.device_id.is_none() {
            info!("No device_id — registering with brain...");
            if let Err(e) = register_device(&mut cfg).await {
                error!("Registration failed: {:#}", e);
                let _ = tray_tx.send(TrayMsg::Error);
                sleep_or_quit(backoff, &quit).await;
                backoff = (backoff * 2).min(MAX_BACKOFF);
                continue;
            }
            backoff = INITIAL_BACKOFF;
        }

        let ws_url = cfg.ws_url();
        info!("Connecting to {}", ws_url);

        match tokio_tungstenite::connect_async(&ws_url).await {
            Err(e) => {
                warn!("WebSocket connect failed: {:#}", e);
                let _ = tray_tx.send(TrayMsg::Error);
                sleep_or_quit(backoff, &quit).await;
                backoff = (backoff * 2).min(MAX_BACKOFF);
            }
            Ok((ws_stream, _)) => {
                info!("Connected");
                let _ = tray_tx.send(TrayMsg::Connected);
                backoff = INITIAL_BACKOFF;

                // Auto-check for updates once after the first successful connection
                if !update_checked_once {
                    update_checked_once = true;
                    updater::check_async(cfg.brain_url.clone(), update_checking.clone());
                }

                let (mut write, mut read) = ws_stream.split();
                let (out_tx, mut out_rx) = async_mpsc::unbounded_channel::<Message>();

                // Writer task
                let write_task = tokio::spawn(async move {
                    while let Some(msg) = out_rx.recv().await {
                        if write.send(msg).await.is_err() {
                            break;
                        }
                    }
                });

                // Process incoming messages
                loop {
                    if quit.load(Ordering::Relaxed) {
                        break;
                    }

                    let msg = tokio::time::timeout(
                        Duration::from_secs(30),
                        read.next(),
                    )
                    .await;

                    match msg {
                        Err(_) => {
                            // Timeout — send a heartbeat to keep the connection alive
                            let _ = out_tx.send(Message::Text(
                                json!({"type": "heartbeat"}).to_string().into(),
                            ));
                        }
                        Ok(None) | Ok(Some(Err(_))) => {
                            warn!("WebSocket disconnected");
                            break;
                        }
                        Ok(Some(Ok(Message::Text(text)))) => {
                            handle_message(
                                text.as_str(),
                                &dispatcher,
                                &out_tx,
                            )
                            .await;
                        }
                        Ok(Some(Ok(Message::Close(_)))) => {
                            info!("Server closed connection");
                            break;
                        }
                        Ok(Some(Ok(_))) => {} // binary/ping/pong — ignore
                    }
                }

                write_task.abort();
                let _ = tray_tx.send(TrayMsg::Disconnected);
                sleep_or_quit(backoff, &quit).await;
                backoff = (backoff * 2).min(MAX_BACKOFF);
            }
        }
    }
}

async fn handle_message(
    text: &str,
    dispatcher: &Arc<Dispatcher>,
    out_tx: &async_mpsc::UnboundedSender<Message>,
) {
    let frame: Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(e) => {
            warn!("Invalid JSON from server: {:#}", e);
            return;
        }
    };

    match frame.get("type").and_then(|v| v.as_str()) {
        Some("heartbeat") => {
            let _ = out_tx.send(Message::Text(
                json!({"type": "heartbeat"}).to_string().into(),
            ));
        }
        Some("tool_call") => {
            dispatch_call(&frame, dispatcher, out_tx).await;
        }
        Some("queue_drain") => {
            if let Some(tasks) = frame.get("tasks").and_then(|v| v.as_array()) {
                for task in tasks.clone() {
                    dispatch_call(&task, dispatcher, out_tx).await;
                }
            }
        }
        other => {
            warn!("Unknown message type: {:?}", other);
        }
    }
}

async fn dispatch_call(
    frame: &Value,
    dispatcher: &Arc<Dispatcher>,
    out_tx: &async_mpsc::UnboundedSender<Message>,
) {
    let call_id = frame.get("call_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let tool = frame.get("tool")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let args = frame.get("args").cloned().unwrap_or(Value::Object(Default::default()));

    let dispatcher = Arc::clone(dispatcher);
    let out_tx = out_tx.clone();
    let call_id_clone = call_id.clone();

    tokio::spawn(async move {
        let (result, is_error, category) =
            tokio::task::spawn_blocking(move || dispatcher.dispatch(&tool, args))
                .await
                .unwrap_or_else(|e| {
                    (
                        Value::String(format!("Task panic: {}", e)),
                        true,
                        Some("unknown".into()),
                    )
                });

        let reply = if is_error {
            json!({
                "type": "tool_error",
                "call_id": call_id_clone,
                "error": result,
                "category": category.unwrap_or_else(|| "unknown".into())
            })
        } else {
            json!({
                "type": "tool_result",
                "call_id": call_id_clone,
                "result": result
            })
        };

        let _ = out_tx.send(Message::Text(reply.to_string().into()));
    });
}

async fn sleep_or_quit(duration: Duration, quit: &Arc<AtomicBool>) {
    let step = Duration::from_millis(200);
    let mut elapsed = Duration::ZERO;
    while elapsed < duration {
        if quit.load(Ordering::Relaxed) {
            return;
        }
        tokio::time::sleep(step).await;
        elapsed += step;
    }
}
