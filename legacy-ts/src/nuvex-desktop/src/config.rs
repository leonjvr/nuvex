use anyhow::{Context, Result};
use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub brain_url: String,
    pub auth_token: String,
    pub device_id: Option<String>,
    pub device_name: String,
    #[serde(default = "default_mode")]
    pub desktop_mode: String,
    #[serde(default = "default_idle")]
    pub idle_threshold_seconds: u32,
}

fn default_mode() -> String { "ask".into() }
fn default_idle() -> u32 { 60 }

impl Default for Config {
    fn default() -> Self {
        Self {
            brain_url: "http://localhost:9100".into(),
            auth_token: String::new(),
            device_id: None,
            device_name: hostname::get()
                .map(|h| h.to_string_lossy().into_owned())
                .unwrap_or_else(|_| "my-pc".into()),
            desktop_mode: "ask".into(),
            idle_threshold_seconds: 60,
        }
    }
}

impl Config {
    pub fn config_path() -> Result<PathBuf> {
        let dirs = ProjectDirs::from("", "", "Nuvex")
            .context("Cannot determine config directory")?;
        Ok(dirs.config_dir().join("config.toml"))
    }

    pub fn log_path() -> Result<PathBuf> {
        let dirs = ProjectDirs::from("", "", "Nuvex")
            .context("Cannot determine config directory")?;
        Ok(dirs.config_dir().join("desktop-agent.log"))
    }

    pub fn load() -> Result<Option<Self>> {
        let path = Self::config_path()?;
        if !path.exists() {
            return Ok(None);
        }
        let text = std::fs::read_to_string(&path)
            .with_context(|| format!("Cannot read config at {}", path.display()))?;
        let cfg: Config = toml::from_str(&text)
            .with_context(|| format!("Cannot parse config at {}", path.display()))?;
        Ok(Some(cfg))
    }

    pub fn save(&self) -> Result<()> {
        let path = Self::config_path()?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("Cannot create config dir {}", parent.display()))?;
        }
        let text = toml::to_string_pretty(self)
            .context("Cannot serialise config")?;
        std::fs::write(&path, text)
            .with_context(|| format!("Cannot write config to {}", path.display()))?;
        Ok(())
    }

    pub fn ws_url(&self) -> String {
        let base = self.brain_url
            .replace("https://", "wss://")
            .replace("http://", "ws://");
        let id = self.device_id.as_deref().unwrap_or("");
        format!("{}/devices/{}/ws", base.trim_end_matches('/'), id)
    }
}
