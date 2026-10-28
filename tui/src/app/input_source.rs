//! Following the comment box with the system input source.
//!
//! A Chinese or Japanese input method holds plain letters while it composes, so review keys
//! like `e` and `q` never arrive. A host that knows the user's input sources sets
//! `PLANNOTATOR_TUI_INPUT_SOURCE` to a helper with Slash Saver's `input-source` verbs and
//! `PLANNOTATOR_TUI_TEXT_INPUT_SOURCE` to the source the user writes in, and starts the
//! review in an ASCII source. Opening a comment or edit box selects the writing source;
//! closing it remembers whatever source was in use and returns to ASCII.

use std::path::PathBuf;
use std::process::Command;

use super::{App, Mode};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct InputSource {
    helper: PathBuf,
    text: String,
}

impl InputSource {
    /// The helper and writing source a host asked for, if it named both.
    pub(crate) fn from_env() -> Option<Self> {
        let helper = std::env::var_os("PLANNOTATOR_TUI_INPUT_SOURCE").filter(|value| !value.is_empty())?;
        let text =
            std::env::var("PLANNOTATOR_TUI_TEXT_INPUT_SOURCE").ok().filter(|value| !value.is_empty())?;
        Some(Self { helper: PathBuf::from(helper), text })
    }

    fn run(&self, args: &[&str]) -> Result<String, String> {
        let output = Command::new(&self.helper)
            .arg("input-source")
            .args(args)
            .output()
            .map_err(|err| format!("{}: {err}", self.helper.display()))?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
    }

    fn for_text(&self) -> Result<(), String> {
        self.run(&["select", &self.text]).map(drop)
    }

    /// Back to ASCII, keeping the source the comment was written in for the next one.
    fn for_keys(&mut self) -> Result<(), String> {
        let previous = self.run(&["ascii"])?;
        if !previous.is_empty() {
            self.text = previous;
        }
        Ok(())
    }
}

impl App {
    /// Whether a comment or edit box is open.
    pub(super) const fn is_writing(&self) -> bool {
        matches!(self.mode, Mode::Compose | Mode::Edit(_))
    }

    /// Called after every event, with whether a box was open before it.
    pub(super) fn follow_input_source(&mut self, was_writing: bool) {
        let is_writing = self.is_writing();
        let Some(source) = self.input_source.as_mut() else { return };
        let result = match (was_writing, is_writing) {
            (false, true) => source.for_text(),
            (true, false) => source.for_keys(),
            _ => return,
        };
        if let Err(err) = result {
            self.status = Some(format!("input source: {err}"));
        }
    }
}

#[cfg(test)]
mod tests;
