//! Opt-in, local-only Kitty artwork. No capability queries, environment guesses of support,
//! Picker constructors (which can mutate tmux), or out-of-band image drawing.

use std::collections::hash_map::RandomState;
use std::hash::BuildHasher;
use std::io::Write;

use anyhow::{Context, Result};
use image::{DynamicImage, ImageReader, RgbaImage, imageops};
use ratatui::crossterm::terminal::{WindowSize, window_size};
use ratatui::layout::Size;
use ratatui_image::protocol::{Protocol, kitty::Kitty};

use crate::config::UiConfig;

pub(crate) const FILES: [&str; 4] =
    ["emoji_thumbsup_v2.png", "emoji_typing.png", "emoji_done.png", "emoji_get_v3.png"];

pub(crate) struct ToolbarImages {
    pub(crate) protocols: [Protocol; 4],
    pub(crate) size: Size,
    ids: [u32; 4],
}

impl ToolbarImages {
    /// Complete all fallible work before taking ownership of the terminal.
    pub(crate) fn from_runtime(ui: &UiConfig) -> Result<Option<Self>> {
        let window = if ui.toolbar_images.is_some() && ui.toolbar_image_cell_size.is_none() {
            window_size().ok()
        } else {
            None
        };
        Self::load(ui, |key| std::env::var(key).ok(), window)
    }

    pub(crate) fn load(
        ui: &UiConfig,
        env: impl Fn(&str) -> Option<String>,
        window: Option<WindowSize>,
    ) -> Result<Option<Self>> {
        ui.validate_toolbar_images()?;
        let Some(directory) = &ui.toolbar_images else { return Ok(None) };
        validate_transport(env)?;
        let [cell_width, cell_height] = cell_pixels(ui.toolbar_image_cell_size, window)?;
        let columns = cell_height.div_ceil(cell_width);
        anyhow::ensure!(
            columns <= 16,
            "toolbar image cell aspect ratio is too tall; check toolbar_image_cell_size"
        );
        let size = Size::new(columns, 1);
        let pixel_width = u32::from(columns) * u32::from(cell_width);
        let pixel_height = u32::from(cell_height);
        let artwork_edge = ((pixel_height * 85 + 50) / 100).max(1);
        // A fresh randomized namespace per instance, with four distinct nonzero IDs. Only
        // these IDs are ever deleted; do not issue Kitty's delete-all command.
        let base = (RandomState::new().hash_one(std::process::id()) as u32 & 0x3fff_ffff) + 1;
        let ids = [base, base + 1, base + 2, base + 3];
        let mut protocols = Vec::with_capacity(FILES.len());
        for (file, id) in FILES.iter().zip(ids) {
            let path = directory.join(file);
            // Explicit PNG decoding, bounded before allocation; no format sniffing or
            // extra codecs. The artwork remains outside source, fixtures and artifacts.
            let mut reader = ImageReader::with_format(
                std::io::BufReader::new(std::fs::File::open(&path).with_context(|| {
                    format!("opening toolbar PNG {}; fix [ui] toolbar_images or disable it", path.display())
                })?),
                image::ImageFormat::Png,
            );
            let mut limits = image::Limits::default();
            limits.max_image_width = Some(4096);
            limits.max_image_height = Some(4096);
            limits.max_alloc = Some(64 * 1024 * 1024);
            reader.limits(limits);
            let decoded =
                reader.decode().with_context(|| format!("decoding toolbar PNG {}", path.display()))?;
            anyhow::ensure!(
                decoded.width() > 0 && decoded.height() > 0,
                "empty toolbar PNG {}",
                path.display()
            );
            let artwork =
                decoded.resize(artwork_edge, artwork_edge, imageops::FilterType::Lanczos3).to_rgba8();
            let mut canvas = RgbaImage::new(pixel_width, pixel_height);
            imageops::overlay(
                &mut canvas,
                &artwork,
                i64::from((pixel_width - artwork.width()) / 2),
                i64::from((pixel_height - artwork.height()) / 2),
            );
            // No tmux wrapping or compression: compression support would need a query.
            protocols.push(Protocol::Kitty(Kitty::new(
                DynamicImage::ImageRgba8(canvas),
                size,
                id,
                false,
                false,
            )?));
        }
        let protocols = protocols.try_into().map_err(|_| anyhow::anyhow!("expected four toolbar images"))?;
        Ok(Some(Self { protocols, size, ids }))
    }

    /// Placeholders disappear through Ratatui's normal diff on hide/move. Retain their
    /// virtual images for reuse during this app, then free only our IDs on every exit.
    pub(crate) fn cleanup(&self, writer: &mut impl Write) -> std::io::Result<()> {
        for id in self.ids {
            write!(writer, "\x1b_Ga=d,d=I,i={id},q=2;\x1b\\")?;
        }
        writer.flush()
    }
}

fn cell_pixels(explicit: Option<[u16; 2]>, window: Option<WindowSize>) -> Result<[u16; 2]> {
    let pixels = explicit.or_else(|| {
        let window = window?;
        if window.columns == 0 || window.rows == 0 {
            return None;
        }
        Some([window.width / window.columns, window.height / window.rows])
    });
    match pixels {
        Some([width, height]) if (1..=256).contains(&width) && (1..=256).contains(&height) => {
            Ok([width, height])
        }
        _ => anyhow::bail!(
            "terminal cell pixels unavailable; set [ui] toolbar_image_cell_size = [width, height] \
             to measured cell pixels, or remove toolbar_images and toolbar_image_protocol"
        ),
    }
}

fn validate_transport(env: impl Fn(&str) -> Option<String>) -> Result<()> {
    let term = env("TERM").unwrap_or_default().to_lowercase();
    let program = env("TERM_PROGRAM").unwrap_or_default().to_lowercase();
    let multiplexed = ["TMUX", "STY", "ZELLIJ"].iter().any(|key| env(key).is_some_and(|s| !s.is_empty()))
        || term.starts_with("tmux")
        || term.starts_with("screen")
        || ["tmux", "screen", "zellij"].contains(&program.as_str());
    anyhow::ensure!(
        !multiplexed,
        "Kitty toolbar images are a direct-terminal local trial; leave tmux/screen/zellij or disable [ui] toolbar_images (no multiplexer settings are changed)"
    );
    anyhow::ensure!(
        term != "dumb" && term != "linux",
        "this terminal cannot render Kitty toolbar images; disable [ui] toolbar_images"
    );
    anyhow::ensure!(
        !["apple_terminal", "iterm.app", "wezterm", "vscode"].contains(&program.as_str())
            && env("WEZTERM_EXECUTABLE").is_none()
            && env("KONSOLE_VERSION").is_none(),
        "this terminal does not support the required Kitty Unicode placeholders; use a verified compatible terminal or disable [ui] toolbar_images"
    );
    // Unknown environments aren't capability evidence. Setting protocol="kitty" is the
    // user's explicit opt-in after verifying Unicode-placeholder support end to end.
    Ok(())
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::indexing_slicing, reason = "tests assert by panicking")]
pub(crate) mod tests {
    use super::*;
    use crate::config::Config;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    pub(crate) struct Fixture {
        pub(crate) ui: UiConfig,
        pub(crate) directory: PathBuf,
    }

    impl Fixture {
        pub(crate) fn new() -> Self {
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let directory = std::env::temp_dir().join(format!(
                "annotate-toolbar-{}-{}-{}",
                std::process::id(),
                SystemTime::now().duration_since(UNIX_EPOCH).expect("clock").as_nanos(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            assert!(directory.is_absolute(), "fixtures require a native absolute temp path");
            std::fs::create_dir(&directory).expect("unique fixture dir");
            for (index, name) in FILES.iter().enumerate() {
                let pixels = RgbaImage::from_fn(12, 12, |x, y| {
                    image::Rgba([index as u8 * 50, x as u8 * 20, y as u8 * 20, 255])
                });
                pixels
                    .save_with_format(directory.join(name), image::ImageFormat::Png)
                    .expect("generated PNG");
            }
            let ui = UiConfig {
                toolbar_images: Some(directory.clone()),
                toolbar_image_protocol: Some("kitty".to_owned()),
                toolbar_image_cell_size: Some([8, 16]),
                ..UiConfig::default()
            };
            Self { ui, directory }
        }

        pub(crate) fn load(&self) -> ToolbarImages {
            ToolbarImages::load(&self.ui, |_| None, None).expect("loads generated assets").expect("enabled")
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.directory);
        }
    }

    #[test]
    fn config_default_roundtrip_and_invalid_image_opt_ins() {
        assert!(
            ToolbarImages::load(&UiConfig::default(), |_| Some("tmux".to_owned()), None)
                .expect("disabled")
                .is_none()
        );
        let fixture = Fixture::new();
        let config = Config { ui: fixture.ui.clone(), ..Config::default() };
        assert_eq!(Config::parse(&config.to_toml().expect("serialize")).expect("parse"), config);
        let path = toml::Value::String(fixture.directory.to_str().expect("UTF-8 fixture path").to_owned());
        for (fields, detail) in [
            (format!("toolbar_images = {path}"), "absolute toolbar_images"),
            ("toolbar_image_protocol = 'kitty'".to_owned(), "absolute toolbar_images"),
            (
                "toolbar_images = 'relative'\ntoolbar_image_protocol = 'kitty'".to_owned(),
                "absolute toolbar_images",
            ),
            (format!("toolbar_images = {path}\ntoolbar_image_protocol = 'sixel'"), "absolute toolbar_images"),
            (
                format!(
                    "toolbar_images = {path}\ntoolbar_image_protocol = 'kitty'\ntoolbar_image_cell_size = [0, 16]"
                ),
                "each in 1..=256",
            ),
            (
                format!(
                    "toolbar_images = {path}\ntoolbar_image_protocol = 'kitty'\ntoolbar_image_cell_size = [8, 257]"
                ),
                "each in 1..=256",
            ),
            ("toolbar_image_cell_size = [8, 16]".to_owned(), "absolute toolbar_images"),
        ] {
            let error = Config::parse(&format!("[ui]\n{fields}\n")).expect_err("invalid image config");
            assert!(error.to_string().contains(detail), "wrong validation for {fields}: {error}");
        }
    }

    #[test]
    fn opted_in_missing_corrupt_and_non_png_files_are_actionable_errors() {
        let fixture = Fixture::new();
        assert_eq!(fixture.load().size, Size::new(2, 1));
        let path = fixture.directory.join(FILES[2]);
        std::fs::remove_file(&path).expect("remove");
        let err = ToolbarImages::load(&fixture.ui, |_| None, None).err().expect("missing rejected");
        assert!(format!("{err:#}").contains("emoji_done.png"));
        assert!(format!("{err:#}").contains("toolbar_images"));
        for contents in [b"broken".as_slice(), b"GIF89a".as_slice()] {
            std::fs::write(&path, contents).expect("corrupt fixture");
            let err = ToolbarImages::load(&fixture.ui, |_| None, None).err().expect("bad PNG rejected");
            assert!(format!("{err:#}").contains("decoding toolbar PNG"));
            assert!(format!("{err:#}").contains("emoji_done.png"));
        }
    }

    #[test]
    fn explicit_mode_rejects_multiplexers_and_known_unsupported_transports_without_queries() {
        for (key, value) in [
            ("TMUX", "/private/tmux,0,0"),
            ("STY", "screen"),
            ("ZELLIJ", "0"),
            ("TERM", "tmux-256color"),
            ("TERM", "screen-256color"),
            ("TERM", "dumb"),
            ("TERM_PROGRAM", "Apple_Terminal"),
            ("TERM_PROGRAM", "iTerm.app"),
            ("TERM_PROGRAM", "WezTerm"),
            ("TERM_PROGRAM", "vscode"),
            ("WEZTERM_EXECUTABLE", "/wezterm"),
            ("KONSOLE_VERSION", "123"),
        ] {
            assert!(
                validate_transport(|k| (k == key).then(|| value.to_owned())).is_err(),
                "reject {key}={value}"
            );
        }
        assert!(
            validate_transport(|_| None).is_ok(),
            "explicit config is an assertion, not an env-based support claim"
        );
    }

    #[test]
    fn cell_pixels_use_ioctl_or_measured_override_never_an_arbitrary_default() {
        assert_eq!(
            cell_pixels(None, Some(WindowSize { rows: 30, columns: 100, width: 800, height: 480 }))
                .expect("ioctl"),
            [8, 16]
        );
        assert_eq!(cell_pixels(Some([10, 20]), None).expect("override"), [10, 20]);
        assert_eq!(
            cell_pixels(Some([10, 20]), Some(WindowSize { rows: 30, columns: 100, width: 0, height: 0 }))
                .expect("override with zero proxy pixels"),
            [10, 20]
        );
        assert!(cell_pixels(None, None).expect_err("error").to_string().contains("toolbar_image_cell_size"));
        assert!(cell_pixels(None, Some(WindowSize { rows: 30, columns: 100, width: 0, height: 0 })).is_err());
        assert!(
            cell_pixels(None, Some(WindowSize { rows: 0, columns: 0, width: 800, height: 480 })).is_err()
        );
    }

    #[test]
    fn cleanup_deletes_exactly_the_owned_ids() {
        let images = Fixture::new().load();
        let mut bytes = Vec::new();
        images.cleanup(&mut bytes).expect("cleanup");
        let output = String::from_utf8(bytes).expect("ANSI");
        assert_eq!(output.matches("\x1b_Ga=d,d=I,i=").count(), 4);
        for id in images.ids {
            assert!(output.contains(&format!("i={id},q=2;")));
        }
        assert!(!output.contains("d=A") && !output.contains("d=a"));
    }
}
