use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use eframe::egui;
use winit::platform::windows::EventLoopBuilderExtWindows;

use crate::config::Config;

// === colour palette (Windows 11 dark Fluent) =================================
const BG: egui::Color32 = egui::Color32::from_rgb(32, 32, 32);
const BG_INPUT: egui::Color32 = egui::Color32::from_rgb(43, 43, 43);
const BG_HOVER: egui::Color32 = egui::Color32::from_rgb(58, 58, 58);
const ACCENT: egui::Color32 = egui::Color32::from_rgb(0, 120, 212);
const LABEL: egui::Color32 = egui::Color32::from_rgb(167, 167, 167);
const HINT: egui::Color32 = egui::Color32::from_rgb(100, 100, 100);
const TEXT: egui::Color32 = egui::Color32::from_rgb(230, 230, 230);
const GREEN: egui::Color32 = egui::Color32::from_rgb(78, 201, 78);
const RED: egui::Color32 = egui::Color32::from_rgb(240, 80, 80);

// === save callback ===========================================================
type SaveCb = Box<dyn FnOnce(Config) + Send>;

// === app state ===============================================================
struct SettingsApp {
    brain_url: String,
    auth_token: String,
    device_name: String,
    desktop_mode: String,
    idle_threshold: String,
    saved_device_id: String,
    status: String,
    status_ok: bool,
    initialized: bool,
    test_rx: Option<std::sync::mpsc::Receiver<(bool, String)>>,
    on_save: Option<SaveCb>,
}

impl SettingsApp {
    fn new(cfg: Config, on_save: SaveCb) -> Self {
        Self {
            brain_url: cfg.brain_url,
            auth_token: cfg.auth_token,
            device_name: cfg.device_name,
            desktop_mode: cfg.desktop_mode,
            idle_threshold: cfg.idle_threshold_seconds.to_string(),
            saved_device_id: cfg.device_id.unwrap_or_default(),
            status: String::new(),
            status_ok: true,
            initialized: false,
            test_rx: None,
            on_save: Some(on_save),
        }
    }

    fn to_config(&self) -> Config {
        Config {
            brain_url: self.brain_url.trim().to_string(),
            auth_token: self.auth_token.trim().to_string(),
            device_id: if self.saved_device_id.is_empty() { None } else { Some(self.saved_device_id.clone()) },
            device_name: self.device_name.trim().to_string(),
            desktop_mode: self.desktop_mode.clone(),
            idle_threshold_seconds: self
                .idle_threshold
                .parse::<u32>()
                .unwrap_or(60)
                .clamp(15, 3600),
        }
    }

    fn apply_theme(ctx: &egui::Context) {
        let mut vis = egui::Visuals::dark();
        vis.panel_fill = BG;
        vis.window_fill = BG;
        vis.extreme_bg_color = egui::Color32::from_rgb(20, 20, 20);
        vis.faint_bg_color = BG_INPUT;
        vis.selection.bg_fill = ACCENT;
        vis.hyperlink_color = ACCENT;
        vis.window_rounding = egui::Rounding::same(8.0);
        vis.menu_rounding = egui::Rounding::same(8.0);

        for w in [
            &mut vis.widgets.noninteractive,
            &mut vis.widgets.inactive,
            &mut vis.widgets.hovered,
            &mut vis.widgets.active,
            &mut vis.widgets.open,
        ] {
            w.rounding = egui::Rounding::same(6.0);
            w.fg_stroke.color = TEXT;
        }
        vis.widgets.noninteractive.bg_fill = BG_INPUT;
        vis.widgets.inactive.bg_fill = BG_INPUT;
        vis.widgets.hovered.bg_fill = BG_HOVER;
        vis.widgets.active.bg_fill = ACCENT;
        ctx.set_visuals(vis);

        let mut style = (*ctx.style()).clone();
        style.spacing.item_spacing = egui::vec2(8.0, 8.0);
        style.spacing.button_padding = egui::vec2(14.0, 7.0);
        style.spacing.window_margin = egui::Margin::same(24.0);
        use egui::{FontFamily::Proportional, FontId, TextStyle::*};
        style.text_styles.insert(Heading, FontId::new(20.0, Proportional));
        style.text_styles.insert(Body, FontId::new(14.0, Proportional));
        style.text_styles.insert(Button, FontId::new(13.0, Proportional));
        style.text_styles.insert(Small, FontId::new(11.0, Proportional));
        ctx.set_style(style);

        // Try to use system Segoe UI; fall back to egui built-in font
        if let Ok(bytes) = std::fs::read("C:\\Windows\\Fonts\\segoeui.ttf") {
            let mut fonts = egui::FontDefinitions::default();
            fonts.font_data.insert("Segoe UI".into(), egui::FontData::from_owned(bytes));
            fonts.families.get_mut(&Proportional).unwrap().insert(0, "Segoe UI".into());
            ctx.set_fonts(fonts);
        }
    }

    fn accent_button(ui: &mut egui::Ui, label: &str) -> egui::Response {
        ui.add(
            egui::Button::new(egui::RichText::new(label).color(egui::Color32::WHITE))
                .fill(ACCENT)
                .stroke(egui::Stroke::NONE)
                .rounding(egui::Rounding::same(6.0))
                .min_size(egui::vec2(120.0, 32.0)),
        )
    }

    fn secondary_button(ui: &mut egui::Ui, label: &str) -> egui::Response {
        ui.add(
            egui::Button::new(egui::RichText::new(label).color(TEXT))
                .fill(BG_INPUT)
                .stroke(egui::Stroke::new(1.0, egui::Color32::from_rgb(68, 68, 68)))
                .rounding(egui::Rounding::same(6.0))
                .min_size(egui::vec2(90.0, 32.0)),
        )
    }
}

impl eframe::App for SettingsApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        if !self.initialized {
            self.initialized = true;
            Self::apply_theme(ctx);
        }

        // Poll background test-connection result
        if let Some(rx) = &self.test_rx {
            if let Ok((ok, msg)) = rx.try_recv() {
                self.status = msg;
                self.status_ok = ok;
                self.test_rx = None;
            }
        }

        egui::CentralPanel::default()
            .frame(egui::Frame::none().fill(BG).inner_margin(egui::Margin::same(24.0)))
            .show(ctx, |ui| {
                ui.label(
                    egui::RichText::new("NUVEX Desktop Agent")
                        .size(20.0)
                        .strong()
                        .color(egui::Color32::WHITE),
                );
                ui.label(egui::RichText::new("Connection settings").size(12.0).color(HINT));
                ui.add_space(20.0);

                egui::Grid::new("fields")
                    .num_columns(2)
                    .spacing([16.0, 12.0])
                    .min_col_width(120.0)
                    .show(ui, |ui| {
                        lbl(ui, "Brain URL");
                        ui.add(egui::TextEdit::singleline(&mut self.brain_url).text_color(TEXT).desired_width(300.0));
                        ui.end_row();

                        lbl(ui, "Auth Token");
                        ui.add(egui::TextEdit::singleline(&mut self.auth_token).password(true).text_color(TEXT).desired_width(300.0));
                        ui.end_row();

                        lbl(ui, "Device Name");
                        ui.add(egui::TextEdit::singleline(&mut self.device_name).text_color(TEXT).desired_width(300.0));
                        ui.end_row();

                        lbl(ui, "Mode");
                        ui.horizontal(|ui| {
                            ui.radio_value(&mut self.desktop_mode, "ask".to_string(), egui::RichText::new("Ask permission").color(TEXT));
                            ui.add_space(8.0);
                            ui.radio_value(&mut self.desktop_mode, "auto".to_string(), egui::RichText::new("Auto-execute").color(TEXT));
                        });
                        ui.end_row();

                        lbl(ui, "Idle Threshold");
                        ui.horizontal(|ui| {
                            ui.add(egui::TextEdit::singleline(&mut self.idle_threshold).text_color(TEXT).desired_width(70.0));
                            ui.label(egui::RichText::new("seconds  (15 - 3600)").size(12.0).color(HINT));
                        });
                        ui.end_row();
                    });

                ui.add_space(16.0);
                ui.add(egui::Separator::default().spacing(0.0));
                ui.add_space(8.0);

                // Status line
                if !self.status.is_empty() {
                    let color = if self.status_ok { GREEN } else { RED };
                    ui.label(egui::RichText::new(&self.status).size(13.0).color(color));
                } else {
                    ui.label(egui::RichText::new(" ").size(13.0));
                }
                ui.add_space(8.0);

                // Buttons row
                ui.horizontal(|ui| {
                    let testing = self.test_rx.is_some();
                    let test_lbl = if testing { "Testing..." } else { "Test Connection" };
                    let test_btn = egui::Button::new(egui::RichText::new(test_lbl).color(TEXT))
                        .fill(BG_INPUT)
                        .stroke(egui::Stroke::new(1.0, egui::Color32::from_rgb(68, 68, 68)))
                        .rounding(egui::Rounding::same(6.0))
                        .min_size(egui::vec2(130.0, 32.0));

                    if ui.add_enabled(!testing, test_btn).clicked() {
                        let url = format!("{}/health", self.brain_url.trim_end_matches('/'));
                        let (tx, rx) = std::sync::mpsc::channel();
                        self.test_rx = Some(rx);
                        self.status = "Testing connection...".into();
                        self.status_ok = true;
                        let ctx2 = ctx.clone();
                        std::thread::spawn(move || {
                            let outcome = reqwest::blocking::Client::builder()
                                .timeout(std::time::Duration::from_secs(5))
                                .build()
                                .map_err(|e| e.to_string())
                                .and_then(|c| c.get(&url).send().map_err(|e| e.to_string()));
                            let result = match outcome {
                                Ok(r) if r.status().is_success() => (true, "Connection successful".to_string()),
                                Ok(r) => (false, format!("Server returned {}", r.status())),
                                Err(e) => (false, format!("Failed: {e}")),
                            };
                            let _ = tx.send(result);
                            ctx2.request_repaint();
                        });
                    }

                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        if Self::accent_button(ui, "Save & Apply").clicked() {
                            let cfg = self.to_config();
                            if let Some(cb) = self.on_save.take() {
                                cb(cfg);
                            }
                            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                        }
                        ui.add_space(4.0);
                        if Self::secondary_button(ui, "Cancel").clicked() {
                            self.on_save.take();
                            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                        }
                    });
                });
            });
    }
}

fn lbl(ui: &mut egui::Ui, text: &str) {
    ui.label(egui::RichText::new(text).size(13.0).color(LABEL));
}

// === Public API ==============================================================

/// Blocking - used by the first-run wizard (called on main thread).
pub fn run_settings_blocking(cfg: Config, title: &str) -> Option<Config> {
    let result = Arc::new(std::sync::Mutex::new(None::<Config>));
    let result_clone = result.clone();
    let opts = eframe::NativeOptions {
        event_loop_builder: Some(Box::new(|b| { b.with_any_thread(true); })),
        viewport: egui::ViewportBuilder::default()
            .with_title(title)
            .with_inner_size([520.0, 390.0])
            .with_resizable(false),
        ..Default::default()
    };
    let _ = eframe::run_native(
        "nuvex-settings",
        opts,
        Box::new(move |_cc| {
            Ok(Box::new(SettingsApp::new(cfg, Box::new(move |c| {
                *result_clone.lock().unwrap() = Some(c);
            }))))
        }),
    );
    Arc::try_unwrap(result).ok()?.into_inner().ok()?
}

/// Non-blocking - opens settings on a background thread from the tray.
pub fn open_settings_async(
    already_open: Arc<AtomicBool>,
    reconnect_tx: std::sync::mpsc::Sender<Config>,
) {
    if already_open.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        let cfg = Config::load().ok().flatten().unwrap_or_default();
        let opts = eframe::NativeOptions {
            event_loop_builder: Some(Box::new(|b| { b.with_any_thread(true); })),
            viewport: egui::ViewportBuilder::default()
                .with_title("NUVEX Desktop Agent - Settings")
                .with_inner_size([520.0, 390.0])
                .with_resizable(false),
            ..Default::default()
        };
        let _ = eframe::run_native(
            "nuvex-settings",
            opts,
            Box::new(move |_cc| {
                Ok(Box::new(SettingsApp::new(cfg, Box::new(move |saved| {
                    let _ = saved.save();
                    let _ = reconnect_tx.send(saved);
                }))))
            }),
        );
        already_open.store(false, Ordering::SeqCst);
    });
}
