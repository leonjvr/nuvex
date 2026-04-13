use crate::config::Config;
use crate::settings_window;
use anyhow::{bail, Result};

/// Show the first-run setup window. Blocks until the user saves or cancels.
pub fn run_wizard() -> Result<Config> {
    match settings_window::run_settings_blocking(Config::default(), "NUVEX Desktop Agent \u{2014} Setup") {
        Some(cfg) => Ok(cfg),
        None => bail!("Setup cancelled"),
    }
}
