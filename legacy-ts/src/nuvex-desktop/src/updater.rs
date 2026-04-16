use anyhow::{Context, Result};
use std::io::Write;
use std::os::windows::ffi::OsStrExt;
use tracing::{info, warn};

const CURRENT: &str = env!("CARGO_PKG_VERSION");

// Minimal Win32 message box (no extra crate needed)
fn msgbox(text: &str, caption: &str, flags: u32) -> i32 {
    #[link(name = "user32")]
    extern "system" {
        fn MessageBoxW(
            hwnd: *mut std::ffi::c_void,
            text: *const u16,
            caption: *const u16,
            utype: u32,
        ) -> i32;
    }
    fn w(s: &str) -> Vec<u16> {
        std::ffi::OsStr::new(s).encode_wide().chain(Some(0)).collect()
    }
    unsafe { MessageBoxW(std::ptr::null_mut(), w(text).as_ptr(), w(caption).as_ptr(), flags) }
}

const MB_OK: u32 = 0;
const MB_YESNO: u32 = 4;
const MB_ICONQUESTION: u32 = 0x20;
const MB_ICONINFO: u32 = 0x40;
const IDYES: i32 = 6;

/// Spawn a background thread that checks for an update and, if found,
/// asks the user and performs the self-replace + relaunch.
/// Safe to call multiple times; does nothing if `already_checking` is true.
pub fn check_async(brain_url: String, already_checking: std::sync::Arc<std::sync::atomic::AtomicBool>) {
    if already_checking.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        let result = check_inner(&brain_url);
        already_checking.store(false, std::sync::atomic::Ordering::SeqCst);
        if let Err(e) = result {
            warn!("Update check error: {:#}", e);
        }
    });
}

fn check_inner(brain_url: &str) -> Result<()> {
    info!("Checking for updates (current v{})…", CURRENT);
    let url = format!("{}/api/downloads/desktop-agent/latest", brain_url.trim_end_matches('/'));
    let resp = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()?
        .get(&url)
        .send()
        .context("Update check request failed")?;

    if !resp.status().is_success() {
        return Ok(()); // server not reachable / endpoint not supported yet
    }

    let body: serde_json::Value = resp.json().context("Parse version response")?;
    let server_ver = body.get("version")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if server_ver.is_empty() || !is_newer(&server_ver, CURRENT) {
        info!("No update available (server={})", server_ver);
        return Ok(());
    }

    info!("Update available: {} -> {}", CURRENT, server_ver);

    let msg = format!(
        "A new version of NUVEX Desktop Agent is available.\n\nInstalled:  v{}\nAvailable: v{}\n\nDownload and install now?",
        CURRENT, server_ver
    );
    if msgbox(&msg, "Update Available", MB_YESNO | MB_ICONQUESTION) != IDYES {
        return Ok(());
    }

    download_and_apply(brain_url, &server_ver)
}

fn download_and_apply(brain_url: &str, new_version: &str) -> Result<()> {
    let exe_path = std::env::current_exe().context("Cannot locate current exe")?;
    let exe_dir  = exe_path.parent().context("Cannot locate exe directory")?;
    let new_exe  = exe_dir.join("nuvex-desktop-update.exe");
    let script   = exe_dir.join("_nuvex_update.ps1");

    // Download
    let dl_url = format!("{}/api/downloads/desktop-agent/file/windows", brain_url.trim_end_matches('/'));
    info!("Downloading v{} from {}", new_version, dl_url);

    let mut resp = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()?
        .get(&dl_url)
        .send()
        .context("Download request failed")?;

    if !resp.status().is_success() {
        anyhow::bail!("Download failed: {}", resp.status());
    }

    let mut f = std::fs::File::create(&new_exe).context("Cannot create update file")?;
    let bytes = resp.bytes().context("Failed to read download body")?;
    f.write_all(&bytes).context("Failed to write update file")?;
    drop(f);

    info!("Downloaded {} bytes → {:?}", bytes.len(), new_exe);

    // Write self-replace PowerShell script
    let exe_s     = exe_path.to_string_lossy();
    let new_exe_s = new_exe.to_string_lossy();
    let ps_script = format!(
        r#"$ErrorActionPreference = 'Stop'
Start-Sleep -Seconds 2
Move-Item -Force '{new_exe}' '{exe}'
Start-Process '{exe}'
Remove-Item -Force $MyInvocation.MyCommand.Path
"#,
        new_exe = new_exe_s,
        exe     = exe_s
    );
    std::fs::write(&script, &ps_script).context("Cannot write update script")?;

    msgbox(
        &format!("v{} downloaded. The app will restart now.", new_version),
        "Update Ready",
        MB_OK | MB_ICONINFO,
    );

    // Launch updater script then self-exit
    std::process::Command::new("powershell")
        .args([
            "-NonInteractive",
            "-WindowStyle", "Hidden",
            "-File", &script.to_string_lossy(),
        ])
        .spawn()
        .context("Failed to launch update script")?;

    info!("Update script launched — exiting for self-replace");
    std::process::exit(0);
}

/// Returns true if `candidate` is a higher semver than `current`.
fn is_newer(candidate: &str, current: &str) -> bool {
    parse_ver(candidate) > parse_ver(current)
}

fn parse_ver(v: &str) -> (u32, u32, u32) {
    let mut parts = v.trim_start_matches('v').split('.').map(|p| p.parse::<u32>().unwrap_or(0));
    (parts.next().unwrap_or(0), parts.next().unwrap_or(0), parts.next().unwrap_or(0))
}
