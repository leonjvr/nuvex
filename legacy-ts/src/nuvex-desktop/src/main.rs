#![windows_subsystem = "windows"]

mod config;
mod connection;
mod dispatcher;
mod settings_window;
mod tools;
mod tray;
mod updater;
mod wizard;

use anyhow::Result;
use config::Config;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tracing::info;
use tracing_subscriber::EnvFilter;

fn log_path() -> PathBuf {
    directories::ProjectDirs::from("", "", "nuvex-desktop")
        .map(|d| d.data_local_dir().to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."))
        .join("nuvex-desktop.log")
}

fn main() -> Result<()> {
    // Ensure log directory exists and open log file
    let lp = log_path();
    if let Some(parent) = lp.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let log_file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&lp)
        .unwrap_or_else(|_| {
            std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(std::env::temp_dir().join("nuvex-desktop.log"))
                .expect("cannot open any log file")
        });

    let (non_blocking, _guard) = tracing_appender::non_blocking(log_file);
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::fmt()
        .with_writer(non_blocking)
        .with_ansi(false)
        .with_env_filter(filter)
        .with_target(false)
        .init();

    info!("NUVEX Desktop Agent v{}", env!("CARGO_PKG_VERSION"));

    // Load or create config
    let cfg = match Config::load()? {
        Some(c) => c,
        None => {
            info!("No config found — running setup wizard");
            let c = wizard::run_wizard()?;
            c.save()?;
            c
        }
    };

    // Inter-thread communication
    let (tray_tx, tray_rx) = std::sync::mpsc::channel::<tray::TrayMsg>();
    let (reconnect_tx, reconnect_rx) = std::sync::mpsc::channel::<config::Config>();
    let quit_flag = Arc::new(AtomicBool::new(false));

    // Spawn the async runtime on a background thread
    let cfg_bg = cfg.clone();
    let tray_tx_bg = tray_tx.clone();
    let quit_bg = Arc::clone(&quit_flag);

    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("Failed to create Tokio runtime");
        rt.block_on(connection::connect_loop(cfg_bg, quit_bg, tray_tx_bg, reconnect_rx));
    });

    // Run the tray event loop on the main thread (required on Windows)
    let quit_tray = Arc::clone(&quit_flag);
    tray::run_tray(tray_rx, quit_tray, reconnect_tx, cfg.brain_url.clone(), lp)?;

    info!("Exiting");
    quit_flag.store(true, Ordering::Relaxed);
    Ok(())
}

