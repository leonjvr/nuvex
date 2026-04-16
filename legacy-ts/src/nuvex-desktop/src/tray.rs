use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tao::event::{Event, StartCause};
use tao::event_loop::{ControlFlow, EventLoopBuilder};
use tray_icon::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tray_icon::{TrayIconBuilder, TrayIconEvent};
use tracing::info;

use crate::config::Config;
use crate::settings_window;
use crate::updater;

/// Messages sent from the async connection loop to the tray thread.
pub enum TrayMsg {
    Connected,
    Disconnected,
    Error,
    ConfigChanged(String), // new brain_url
}

enum UserEvent {
    TrayIconEvent(TrayIconEvent),
    MenuEvent(MenuEvent),
    StateChange(TrayMsg),
}

/// Run the tray event loop on the current (main) thread.
pub fn run_tray(
    tray_rx: std::sync::mpsc::Receiver<TrayMsg>,
    quit_flag: Arc<AtomicBool>,
    reconnect_tx: std::sync::mpsc::Sender<Config>,
    brain_url: String,
    log_path: PathBuf,
) -> anyhow::Result<()> {
    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();

    let proxy_tray = proxy.clone();
    TrayIconEvent::set_event_handler(Some(move |e| {
        let _ = proxy_tray.send_event(UserEvent::TrayIconEvent(e));
    }));

    let proxy_menu = proxy.clone();
    MenuEvent::set_event_handler(Some(move |e| {
        let _ = proxy_menu.send_event(UserEvent::MenuEvent(e));
    }));

    let proxy_bridge = proxy.clone();
    std::thread::spawn(move || {
        for msg in tray_rx {
            let _ = proxy_bridge.send_event(UserEvent::StateChange(msg));
        }
    });

    let settings_i  = MenuItem::new("Settings", true, None);
    let update_i    = MenuItem::new("Check for Updates", true, None);
    let logs_i      = MenuItem::new("View Logs", true, None);
    let quit_i      = MenuItem::new("Quit", true, None);
    let tray_menu   = Menu::new();
    tray_menu.append(&settings_i).expect("append settings");
    tray_menu.append(&update_i).expect("append update");
    tray_menu.append(&logs_i).expect("append logs");
    tray_menu.append(&PredefinedMenuItem::separator()).expect("append sep");
    tray_menu.append(&quit_i).expect("append quit");

    let settings_open   = Arc::new(AtomicBool::new(false));
    let update_checking = Arc::new(AtomicBool::new(false));
    let mut current_brain_url = brain_url;
    let mut tray_icon = None;

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;

        if quit_flag.load(Ordering::Relaxed) {
            tray_icon.take();
            *control_flow = ControlFlow::Exit;
            return;
        }

        match event {
            Event::NewEvents(StartCause::Init) => {
                tray_icon = Some(
                    TrayIconBuilder::new()
                        .with_menu(Box::new(tray_menu.clone()))
                        .with_tooltip("NUVEX Desktop Agent — Disconnected")
                        .with_icon(make_icon(120, 120, 120))
                        .build()
                        .expect("Failed to create tray icon"),
                );
                info!("Tray icon created");
            }

            Event::UserEvent(UserEvent::TrayIconEvent(TrayIconEvent::Click { button, .. })) => {
                if button == tray_icon::MouseButton::Left {
                    settings_window::open_settings_async(
                        settings_open.clone(),
                        reconnect_tx.clone(),
                    );
                }
            }

            Event::UserEvent(UserEvent::MenuEvent(event)) => {
                if event.id == settings_i.id() {
                    settings_window::open_settings_async(
                        settings_open.clone(),
                        reconnect_tx.clone(),
                    );
                } else if event.id == update_i.id() {
                    updater::check_async(current_brain_url.clone(), update_checking.clone());
                } else if event.id == logs_i.id() {
                    let _ = std::process::Command::new("notepad").arg(&log_path).spawn();
                } else if event.id == quit_i.id() {
                    info!("Quit requested from tray menu");
                    quit_flag.store(true, Ordering::Relaxed);
                    tray_icon.take();
                    *control_flow = ControlFlow::Exit;
                }
            }

            Event::UserEvent(UserEvent::StateChange(msg)) => {
                if let Some(icon) = tray_icon.as_mut() {
                    let (r, g, b, tip) = match &msg {
                        TrayMsg::Connected    => (70, 180, 70,   "NUVEX Desktop Agent — Connected"),
                        TrayMsg::Disconnected => (120, 120, 120, "NUVEX Desktop Agent — Disconnected"),
                        TrayMsg::Error        => (200, 60, 60,   "NUVEX Desktop Agent — Error"),
                        TrayMsg::ConfigChanged(_) => return,
                    };
                    let _ = icon.set_icon(Some(make_icon(r, g, b)));
                    let _ = icon.set_tooltip(Some(tip));
                }
                if let TrayMsg::ConfigChanged(url) = msg {
                    current_brain_url = url;
                }
            }

            _ => {}
        }
    });
}

fn make_icon(r: u8, g: u8, b: u8) -> tray_icon::Icon {
    let size = 22u32;
    let cx = size as f32 / 2.0;
    let radius = cx - 1.5;
    let mut rgba = vec![0u8; (size * size * 4) as usize];
    for y in 0..size {
        for x in 0..size {
            let dx = x as f32 - cx;
            let dy = y as f32 - cx;
            if (dx * dx + dy * dy).sqrt() <= radius {
                let idx = ((y * size + x) * 4) as usize;
                rgba[idx] = r;
                rgba[idx + 1] = g;
                rgba[idx + 2] = b;
                rgba[idx + 3] = 255;
            }
        }
    }
    tray_icon::Icon::from_rgba(rgba, size, size).expect("Failed to create icon")
}

