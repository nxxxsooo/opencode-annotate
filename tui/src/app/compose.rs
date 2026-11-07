//! The comment box: a small multi-line editor.
//!
//! Enter saves; Shift+Enter (where the terminal's keyboard protocol distinguishes it),
//! Alt+Enter and Ctrl+J insert a new line; Esc cancels. The buffer is a char vec with a
//! cursor, wrapped to the box width for display only — the saved body keeps exactly the
//! newlines the user typed.

use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use unicode_width::UnicodeWidthChar;

/// What a keystroke did to the compose box.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ComposeAction {
    Edited,
    Save,
    Cancel,
}

#[derive(Debug, Default)]
pub(super) struct Compose {
    chars: Vec<char>,
    cursor: usize,
}

/// Display cells per row inside the comment box.
pub(super) const WRAP_WIDTH: usize = 45;

fn width_of(c: char) -> usize {
    UnicodeWidthChar::width(c).unwrap_or(0)
}

impl Compose {
    pub(super) fn with_text(text: &str) -> Self {
        let chars: Vec<char> = text.chars().collect();
        let cursor = chars.len();
        Self { chars, cursor }
    }

    pub(super) fn value(&self) -> String {
        self.chars.iter().collect()
    }

    pub(super) fn handle_key(&mut self, key: KeyEvent) -> ComposeAction {
        match key.code {
            KeyCode::Esc => return ComposeAction::Cancel,
            KeyCode::Enter if key.modifiers.intersects(KeyModifiers::SHIFT | KeyModifiers::ALT) => {
                self.insert('\n');
            }
            KeyCode::Enter => return ComposeAction::Save,
            KeyCode::Char('j' | 'J') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.insert('\n');
            }
            KeyCode::Backspace => {
                if self.cursor > 0 {
                    self.cursor -= 1;
                    self.chars.remove(self.cursor);
                }
            }
            KeyCode::Delete => {
                if self.cursor < self.chars.len() {
                    self.chars.remove(self.cursor);
                }
            }
            // Cmd+arrows arrive as Super+arrow (keyboard protocol) or as the Ctrl+A/Ctrl+E and
            // Alt+B/Alt+F that macOS terminals send for Cmd/Option+Left/Right.
            KeyCode::Up if key.modifiers.contains(KeyModifiers::SUPER) => self.cursor = 0,
            KeyCode::Down if key.modifiers.contains(KeyModifiers::SUPER) => self.cursor = self.chars.len(),
            KeyCode::Left if key.modifiers.contains(KeyModifiers::SUPER) => self.line_start(),
            KeyCode::Right if key.modifiers.contains(KeyModifiers::SUPER) => self.line_end(),
            KeyCode::Char('a') if key.modifiers == KeyModifiers::CONTROL => self.line_start(),
            KeyCode::Char('e') if key.modifiers == KeyModifiers::CONTROL => self.line_end(),
            KeyCode::Left if key.modifiers.intersects(KeyModifiers::ALT | KeyModifiers::CONTROL) => {
                self.word(-1);
            }
            KeyCode::Right if key.modifiers.intersects(KeyModifiers::ALT | KeyModifiers::CONTROL) => {
                self.word(1);
            }
            KeyCode::Char('b') if key.modifiers == KeyModifiers::ALT => self.word(-1),
            KeyCode::Char('f') if key.modifiers == KeyModifiers::ALT => self.word(1),
            KeyCode::Left => self.cursor = self.cursor.saturating_sub(1),
            KeyCode::Right => self.cursor = (self.cursor + 1).min(self.chars.len()),
            KeyCode::Up => self.move_vertical(-1, WRAP_WIDTH),
            KeyCode::Down => self.move_vertical(1, WRAP_WIDTH),
            KeyCode::Home => self.line_start(),
            KeyCode::End => self.line_end(),
            KeyCode::Char(c) if !key.modifiers.intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) => {
                self.insert(c);
            }
            _ => {}
        }
        ComposeAction::Edited
    }

    /// Insert pasted text as typed characters, newlines included.
    pub(super) fn insert_text(&mut self, text: &str) {
        for c in text.replace("\r\n", "\n").replace('\r', "\n").chars() {
            self.insert(c);
        }
    }

    fn insert(&mut self, c: char) {
        self.chars.insert(self.cursor, c);
        self.cursor += 1;
    }

    /// Start of the current logical line.
    fn line_start(&mut self) {
        while self.cursor > 0 && self.chars.get(self.cursor - 1) != Some(&'\n') {
            self.cursor -= 1;
        }
    }

    /// End of the current logical line.
    fn line_end(&mut self) {
        while self.cursor < self.chars.len() && self.chars.get(self.cursor) != Some(&'\n') {
            self.cursor += 1;
        }
    }

    /// Jump to the previous word start or the next word end, skipping whitespace first.
    fn word(&mut self, direction: isize) {
        let blank_at = |i: usize| self.chars.get(i).map(|c| c.is_whitespace());
        let mut cursor = self.cursor;
        if direction < 0 {
            while cursor > 0 && blank_at(cursor - 1) == Some(true) {
                cursor -= 1;
            }
            while cursor > 0 && blank_at(cursor - 1) == Some(false) {
                cursor -= 1;
            }
        } else {
            while blank_at(cursor) == Some(true) {
                cursor += 1;
            }
            while blank_at(cursor) == Some(false) {
                cursor += 1;
            }
        }
        self.cursor = cursor;
    }

    /// Move to the display row above or below, landing on the nearest column at or left of
    /// the current one. Past the first or last row the cursor goes to the start or end.
    fn move_vertical(&mut self, delta: isize, width: usize) {
        let (_, spots) = self.layout(width, |_| true);
        let (row, col) = spots.get(self.cursor).copied().unwrap_or_default();
        let last = spots.last().map_or(0, |spot| spot.0);
        let Some(target) = row.checked_add_signed(delta).filter(|&r| r <= last) else {
            self.cursor = if delta < 0 { 0 } else { self.chars.len() };
            return;
        };
        let on_target = || spots.iter().enumerate().filter(|(_, spot)| spot.0 == target);
        self.cursor = on_target()
            .rfind(|(_, spot)| spot.1 <= col)
            .or_else(|| on_target().next())
            .map_or(self.cursor, |(i, _)| i);
    }

    /// The buffer wrapped to `width` display cells, with the cursor's (row, col) in that
    /// wrapping. Explicit newlines always break; a full row wraps to the next, and so does
    /// a cursor that would otherwise sit past the last cell of a full row.
    pub(super) fn wrapped(&self, width: usize) -> (Vec<String>, usize, usize) {
        let (lines, spots) = self.layout(width, |i| i == self.cursor);
        let (row, col) = spots.get(self.cursor).copied().unwrap_or_default();
        (lines, row, col)
    }

    /// The display rows and the (row, col) of every cursor position `0..=len`. A position
    /// right after a full row starts a new row only where `breaks` says so: at the cursor
    /// when drawing, everywhere when moving, so each position has its own cell.
    fn layout(&self, width: usize, breaks: impl Fn(usize) -> bool) -> (Vec<String>, Vec<(usize, usize)>) {
        let width = width.max(1);
        let mut lines = vec![String::new()];
        let mut spots = Vec::with_capacity(self.chars.len() + 1);
        let mut used = 0;
        for i in 0..=self.chars.len() {
            let c = self.chars.get(i).copied();
            let w = match c {
                Some('\n') | None => 0,
                Some(c) => width_of(c),
            };
            if used + w > width || (used >= width && breaks(i)) {
                lines.push(String::new());
                used = 0;
            }
            spots.push((lines.len() - 1, used));
            match c {
                Some('\n') => {
                    lines.push(String::new());
                    used = 0;
                }
                Some(c) => {
                    if let Some(last) = lines.last_mut() {
                        last.push(c);
                    }
                    used += w;
                }
                None => {}
            }
        }
        (lines, spots)
    }
}

#[cfg(test)]
mod tests {
    use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

    use super::{Compose, WRAP_WIDTH};

    fn at(text: &str, cursor: usize) -> Compose {
        let mut compose = Compose::with_text(text);
        compose.cursor = cursor;
        compose
    }

    #[test]
    fn cursor_after_a_full_wide_row_moves_to_the_next_row() {
        let (lines, row, col) = Compose::with_text("翟敏").wrapped(4);
        assert_eq!((lines, row, col), (vec!["翟敏".to_owned(), String::new()], 1, 0));
    }

    #[test]
    fn cursor_before_a_wrapping_wide_char_sits_with_that_char() {
        let (lines, row, col) = at("abc敏", 3).wrapped(4);
        assert_eq!((lines, row, col), (vec!["abc".to_owned(), "敏".to_owned()], 1, 0));
    }

    fn press(compose: &mut Compose, code: KeyCode, modifiers: KeyModifiers) -> usize {
        compose.handle_key(KeyEvent::new(code, modifiers));
        compose.cursor
    }

    #[test]
    fn up_and_down_follow_wrapped_rows() {
        let mut compose = at("abcdefghij", 6);
        compose.move_vertical(-1, 4);
        assert_eq!(compose.cursor, 2, "row 1 col 2 -> row 0 col 2");
        compose.move_vertical(1, 4);
        compose.move_vertical(1, 4);
        assert_eq!(compose.cursor, 10, "the short last row clamps to its end");
        compose.move_vertical(1, 4);
        assert_eq!(compose.cursor, 10);
        compose.move_vertical(-1, 4);
        compose.move_vertical(-1, 4);
        compose.move_vertical(-1, 4);
        assert_eq!(compose.cursor, 0, "past the first row goes to the start");
    }

    #[test]
    fn up_and_down_cross_newlines_and_wide_chars() {
        let mut compose = at("翟敏翟\nabcd", 6);
        compose.move_vertical(-1, 4);
        assert_eq!(compose.cursor, 3, "col 2 of 'abcd' -> after the wrapped 翟");
        compose.move_vertical(-1, 4);
        assert_eq!(compose.cursor, 1, "col 2 on the first row is after 翟");
    }

    #[test]
    fn up_and_down_move_within_one_long_paragraph() {
        let text = "x".repeat(WRAP_WIDTH * 2);
        let mut compose = at(&text, WRAP_WIDTH + 3);
        assert_eq!(press(&mut compose, KeyCode::Up, KeyModifiers::NONE), 3);
        assert_eq!(press(&mut compose, KeyCode::Down, KeyModifiers::NONE), WRAP_WIDTH + 3);
    }

    #[test]
    fn command_and_option_arrows_jump() {
        let mut compose = at("one two\nthree four", 12);
        assert_eq!(press(&mut compose, KeyCode::Left, KeyModifiers::SUPER), 8);
        assert_eq!(press(&mut compose, KeyCode::Right, KeyModifiers::SUPER), 18);
        assert_eq!(press(&mut compose, KeyCode::Char('a'), KeyModifiers::CONTROL), 8);
        assert_eq!(press(&mut compose, KeyCode::Char('e'), KeyModifiers::CONTROL), 18);
        assert_eq!(press(&mut compose, KeyCode::Left, KeyModifiers::ALT), 14);
        assert_eq!(press(&mut compose, KeyCode::Char('b'), KeyModifiers::ALT), 8);
        assert_eq!(press(&mut compose, KeyCode::Char('b'), KeyModifiers::ALT), 4);
        assert_eq!(press(&mut compose, KeyCode::Char('f'), KeyModifiers::ALT), 7);
        assert_eq!(press(&mut compose, KeyCode::Right, KeyModifiers::ALT), 13);
        assert_eq!(press(&mut compose, KeyCode::Up, KeyModifiers::SUPER), 0);
        assert_eq!(press(&mut compose, KeyCode::Down, KeyModifiers::SUPER), 18);
        assert_eq!(compose.value(), "one two\nthree four", "jumps never insert text");
    }

    #[test]
    fn cursor_never_lands_past_the_wrap_width() {
        for text in ["abcd", "ab敏", "翟敏\nx", "敏敏敏敏敏"] {
            for cursor in 0..=text.chars().count() {
                let (_, _, col) = at(text, cursor).wrapped(4);
                assert!(col < 4, "{text:?} cursor {cursor} -> col {col}");
            }
        }
    }
}
