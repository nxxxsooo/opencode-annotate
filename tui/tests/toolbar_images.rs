//! Real CLI boundaries: image errors precede terminal ownership; config/theme copying
//! and plain snapshots remain query-free even with a configured image opt-in.

#![allow(clippy::expect_used, clippy::indexing_slicing, reason = "tests assert by panicking")]

use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

struct Fixture {
    root: PathBuf,
    config: PathBuf,
    document: PathBuf,
}

impl Fixture {
    fn new(label: &str, fields: impl FnOnce(&Path) -> String) -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let root = std::env::temp_dir().join(format!(
            "annotate-image-cli-{}-{}-{}-{label}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).expect("clock").as_nanos(),
            NEXT.fetch_add(1, Ordering::Relaxed),
        ));
        assert!(root.is_absolute(), "fixtures require a native absolute temp path");
        std::fs::create_dir(&root).expect("unique fixture dir");
        let config = root.join("config.toml");
        let document = root.join("plan.md");
        let fields = fields(&root.join("artwork's files"));
        std::fs::write(&config, format!("[ui]\ntheme = 'dark'\n{fields}\n[colors]\naccent = '#abcdef'\n"))
            .expect("config");
        std::fs::write(&document, "# Plan\n\nfirst thing\n").expect("document");
        Self { root, config, document }
    }

    fn command(&self) -> Command {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_annotate-tui"));
        cmd.env("PLANNOTATOR_TUI_CONFIG", &self.config)
            .env_remove("PLANNOTATOR_TUI_THEME")
            .env_remove("TMUX")
            .env_remove("STY")
            .env_remove("ZELLIJ")
            .env_remove("WEZTERM_EXECUTABLE")
            .env_remove("KONSOLE_VERSION")
            .env("TERM_PROGRAM", "explicit-test")
            .env("TERM", "xterm-256color");
        cmd
    }
}

fn image_fields(directory: &Path, fields: &str) -> String {
    let path = toml::Value::String(directory.to_str().expect("UTF-8 fixture path").to_owned());
    format!("toolbar_images = {path}\ntoolbar_image_protocol = 'kitty'\n{fields}")
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn assert_plain_failure(output: &Output, detail: &str) {
    assert!(!output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains(detail), "{stderr}");
    assert!(output.stdout.is_empty(), "no terminal ownership or image output before validation");
    assert!(!stderr.contains('\u{1b}'), "plain actionable error, not terminal control output");
}

#[test]
fn invalid_opt_in_and_missing_assets_fail_before_taking_the_terminal() {
    let invalid = Fixture::new("invalid", |_| "toolbar_image_protocol = 'sixel'".to_owned());
    let output = invalid.command().arg(&invalid.document).output().expect("run");
    assert_plain_failure(&output, "toolbar_image_protocol");

    let missing =
        Fixture::new("missing", |directory| image_fields(directory, "toolbar_image_cell_size = [8, 16]"));
    let output = missing.command().arg(&missing.document).output().expect("run");
    assert_plain_failure(&output, "emoji_thumbsup_v2.png");
    let output =
        missing.command().env("TMUX", "test-multiplexer").arg(&missing.document).output().expect("run");
    assert_plain_failure(&output, "direct-terminal local trial");
}

#[test]
fn image_config_survives_theme_override_and_colors_remain_last() {
    let fixture =
        Fixture::new("roundtrip", |directory| image_fields(directory, "toolbar_image_cell_size = [9, 18]"));
    let output =
        fixture.command().env("PLANNOTATOR_TUI_THEME", "light").arg("config").output().expect("config");
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    let text = String::from_utf8(output.stdout).expect("TOML");
    let config: toml::Value = toml::from_str(&text).expect("parse");
    assert_eq!(config["ui"]["theme"].as_str(), Some("light"));
    assert_eq!(config["ui"]["toolbar_images"].as_str(), fixture.root.join("artwork's files").to_str());
    assert_eq!(config["ui"]["toolbar_image_protocol"].as_str(), Some("kitty"));
    assert_eq!(config["ui"]["toolbar_image_cell_size"][0].as_integer(), Some(9));
    let colors = text.split_once("[colors]").expect("colors remain present").1;
    assert!(!colors.contains('['), "no later table may follow colors: theme.mjs slices here");
    assert!(colors.contains("#abcdef"));
}

#[test]
fn plain_snapshot_does_not_load_assets_or_query_the_terminal() {
    let fixture = Fixture::new("snapshot", |directory| image_fields(directory, ""));
    let output = fixture
        .command()
        .args(["--snapshot"])
        .arg(&fixture.document)
        .args(["80", "20", "0", "first thing"])
        .output()
        .expect("snapshot");
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    let text = String::from_utf8(output.stdout).expect("text");
    assert!(!text.contains('\u{1b}'));
    assert!(text.contains("👍") && text.contains("(enter)"));
}
