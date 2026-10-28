#![allow(clippy::expect_used, reason = "tests assert by panicking")]

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use ratatui::crossterm::event::{Event, KeyCode, KeyEvent};

use super::InputSource;
use crate::app::review_test_support::{file_app, press};
use crate::app::{Focus, Mode};

/// A helper that logs its arguments and, for `ascii`, reports `source` as the one it left.
fn helper(root: &Path, source: &str) -> (PathBuf, PathBuf) {
    let log = root.join("calls");
    let script = root.join("helper");
    std::fs::write(
        &script,
        format!(
            "#!/bin/sh\necho \"$*\" >> '{}'\n[ \"$2\" = ascii ] && echo {source}\nexit 0\n",
            log.display()
        ),
    )
    .expect("helper");
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).expect("chmod");
    (script, log)
}

fn calls(log: &Path) -> Vec<String> {
    std::fs::read_to_string(log).unwrap_or_default().lines().map(str::to_owned).collect()
}

#[test]
fn the_comment_box_writes_in_the_text_source_and_browsing_returns_to_ascii() {
    let (root, mut app, _) = file_app("input-source");
    let (script, log) = helper(&root, "com.example.wubi");
    app.input_source = Some(InputSource { helper: script, text: "com.example.pinyin".into() });

    press(&mut app, 'c');
    assert_eq!(app.mode, Mode::Compose);
    press(&mut app, 'x');
    app.handle_event(&Event::Key(KeyEvent::from(KeyCode::Enter))).expect("save");
    assert_eq!(calls(&log), ["input-source select com.example.pinyin", "input-source ascii"]);

    // The source last written in is the next box's source.
    app.focus = Focus::Rail;
    press(&mut app, 'e');
    assert!(matches!(app.mode, Mode::Edit(_)));
    app.handle_event(&Event::Key(KeyEvent::from(KeyCode::Esc))).expect("cancel");
    assert_eq!(
        calls(&log),
        [
            "input-source select com.example.pinyin",
            "input-source ascii",
            "input-source select com.example.wubi",
            "input-source ascii"
        ]
    );
    std::fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn a_missing_helper_says_so_and_the_review_carries_on() {
    let (root, mut app, _) = file_app("input-source-missing");
    app.input_source = Some(InputSource { helper: root.join("missing"), text: "com.example.pinyin".into() });
    press(&mut app, 'c');
    assert_eq!(app.mode, Mode::Compose);
    assert!(app.status.as_deref().is_some_and(|s| s.starts_with("input source:")), "{:?}", app.status);
    std::fs::remove_dir_all(root).expect("cleanup");
}
