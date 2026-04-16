use anyhow::{Context, Result};
use base64::Engine;
use serde_json::Value;

/// desktop_screenshot — captures a monitor and returns base64-encoded PNG.
/// Args: { "monitor": <int, optional, 0-based> }
pub fn screenshot(args: Value) -> Result<Value> {
    let mon_idx = args.get("monitor")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as usize;

    let screens = screenshots::Screen::all()
        .context("Failed to enumerate screens")?;

    let screen = screens.get(mon_idx)
        .with_context(|| format!("Monitor {} not found (found {})", mon_idx, screens.len()))?;

    let capture = screen.capture()
        .context("Failed to capture screen")?;

    let width = capture.width();
    let height = capture.height();
    let rgba = capture.into_raw();

    let img = image::RgbaImage::from_raw(width, height, rgba)
        .context("Failed to construct RgbaImage from capture")?;

    let mut buf = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(img)
        .write_to(&mut buf, image::ImageFormat::Png)
        .context("Failed to encode PNG")?;

    let b64 = base64::engine::general_purpose::STANDARD.encode(buf.get_ref());

    Ok(serde_json::json!({
        "image_base64": b64,
        "width": width,
        "height": height,
        "monitor": mon_idx
    }))
}
