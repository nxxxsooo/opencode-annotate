//! Explicit host colours for the canvas, cleared popups and otherwise unstyled text.

use ratatui::buffer::Buffer;
use ratatui::style::{Color, Modifier};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Surface {
    pub(crate) foreground: Color,
    pub(crate) background: Color,
    pub(crate) muted: Option<Color>,
    pub(crate) border: Color,
    pub(crate) code: Color,
    pub(crate) link: Color,
    pub(crate) quote: Color,
    /// Markdown roles the renderer leaves to the terminal unless a host supplies them.
    pub(crate) strong: Option<Color>,
    pub(crate) emphasis: Option<Color>,
    pub(crate) list_item: Option<Color>,
    pub(crate) list_number: Option<Color>,
    pub(crate) rule: Option<Color>,
    /// Link labels; `link` then colours only the destination, as the host does.
    pub(crate) link_text: Option<Color>,
}

impl Surface {
    pub(crate) const DEFAULT: Self = Self {
        foreground: Color::Reset,
        background: Color::Reset,
        muted: None,
        border: Color::DarkGray,
        code: Color::LightYellow,
        link: Color::Blue,
        quote: Color::Green,
        strong: None,
        emphasis: None,
        list_item: None,
        list_number: None,
        rule: None,
        link_text: None,
    };

    /// Fill terminal-default colours after drawing, including cells reset by `Clear`.
    /// Explicit annotation/selection styles always win over the canvas.
    pub(crate) fn finish(self, buffer: &mut Buffer) {
        if self.foreground == Color::Reset && self.background == Color::Reset && self.muted.is_none() {
            return;
        }
        for cell in &mut buffer.content {
            if cell.fg == Color::Reset {
                cell.fg = self.foreground;
                if cell.modifier.contains(Modifier::DIM)
                    && let Some(muted) = self.muted
                {
                    cell.fg = muted;
                    cell.modifier.remove(Modifier::DIM);
                }
            }
            if cell.bg == Color::Reset {
                cell.bg = self.background;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::layout::Rect;
    use ratatui::style::Style;

    #[test]
    fn cleared_cells_and_muted_text_inherit_the_host_without_repainting_selections() {
        let area = Rect::new(0, 0, 3, 1);
        let mut buffer = Buffer::empty(area);
        buffer.set_string(0, 0, "a", Style::new().add_modifier(Modifier::DIM));
        buffer.set_string(1, 0, "b", Style::new().fg(Color::Black).bg(Color::Cyan));
        let surface = Surface {
            foreground: Color::White,
            background: Color::Blue,
            muted: Some(Color::Gray),
            ..Surface::DEFAULT
        };
        surface.finish(&mut buffer);
        let cells: Vec<_> = buffer.content.iter().map(|c| (c.fg, c.bg)).collect();
        assert_eq!(
            cells,
            vec![(Color::Gray, Color::Blue), (Color::Black, Color::Cyan), (Color::White, Color::Blue)]
        );
        assert!(buffer.content.iter().all(|c| !c.modifier.contains(Modifier::DIM)));
    }
}
