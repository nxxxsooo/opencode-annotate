//! Per-block rendering and the row map.
//!
//! Each block is rendered in isolation through `tui-markdown` (cached, width-independent),
//! aligned back to its source bytes, and wrapped to the current column width. Every screen
//! cell therefore knows its block and, where it shows real text, its source byte.

use std::ops::Range;

use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Text};
use tui_markdown::{Options, StyleSheet};

use crate::doc::{BlockKind, Document};
use crate::srcmap::{LineOffsets, align};
use crate::theme::{Surface, palette};
use crate::wrap::{Row, clip_line, wrap_line, wrap_table};

/// Rows of vertical space between blocks.
const BLOCK_GAP: usize = 1;

/// House style: no `#` markers, headings carry weight through bold/underline rather than
/// background color, so the palette stays available for selection and annotations.
#[derive(Debug, Clone)]
struct Styles;

impl StyleSheet for Styles {
    fn heading(&self, level: u8) -> Style {
        match level {
            1 => Style::new().fg(palette().heading).add_modifier(Modifier::BOLD | Modifier::UNDERLINED),
            2 => Style::new().fg(palette().heading).add_modifier(Modifier::BOLD),
            _ => Style::new().fg(palette().subheading).add_modifier(Modifier::BOLD),
        }
    }
    fn heading_marker(&self, _level: u8) -> &'static str {
        ""
    }
    fn code(&self) -> Style {
        Style::new().fg(palette().surface.code)
    }
    fn link(&self) -> Style {
        Style::new().fg(palette().surface.link).add_modifier(Modifier::UNDERLINED)
    }
    fn blockquote(&self) -> Style {
        Style::new().fg(palette().surface.quote).add_modifier(Modifier::ITALIC)
    }
    fn table_header(&self) -> Style {
        Style::new().fg(palette().heading).add_modifier(Modifier::BOLD)
    }
    fn table_border(&self) -> Style {
        Style::new().fg(palette().surface.border)
    }
}

#[derive(Debug)]
pub(crate) struct RenderedBlock {
    /// Width-independent styled lines from the renderer (owned, cached).
    text: Text<'static>,
    /// Per line, per char: absolute source byte offset (cached with `text`).
    offsets: Vec<LineOffsets>,
    kind: BlockKind,
    /// Rows for the current width.
    pub(crate) rows: Vec<Row>,
    /// First screen row of this block in document coordinates.
    pub(crate) first_row: usize,
}

#[derive(Debug)]
pub(crate) struct DocLayout {
    pub(crate) width: usize,
    pub(crate) blocks: Vec<RenderedBlock>,
    pub(crate) total_rows: usize,
}

fn render_block(doc: &Document, index: usize) -> (Text<'static>, Vec<LineOffsets>) {
    let source = doc.block_text(index);
    let mut text = own(tui_markdown::from_str_with_options(source, &Options::new(Styles)));
    let plain: Vec<String> = text.lines.iter().map(ToString::to_string).collect();
    let base = doc.blocks.get(index).map_or(0, |b| b.range.start);
    let mut offsets = align(&plain, source, base);
    if let Some(kind) = doc.blocks.get(index).map(|b| b.kind) {
        if !matches!(kind, BlockKind::CodeBlock | BlockKind::Html) {
            for (line, line_offsets) in text.lines.iter_mut().zip(&mut offsets) {
                strong_fallback(line, line_offsets, &doc.source);
            }
        }
        restyle(&mut text, kind, &palette().surface);
    }
    (text, offsets)
}

/// Bold the `**` pairs the spec leaves literal. A closing `**` after punctuation must be
/// followed by whitespace or punctuation, so `**题库：**把` or `**Note:**text` stays as
/// text; CJK prose rarely has the space. An opener must precede and a closer follow a
/// non-space character on the same line; code spans and escaped asterisks are left alone.
fn strong_fallback(line: &mut Line<'static>, offsets: &mut LineOffsets, source: &str) {
    if !line.to_string().contains("**") {
        return;
    }
    let code = Styles.code();
    // (char, style, span index, source offset, eligible as a delimiter)
    let mut cells: Vec<(char, Style, usize, Option<usize>, bool)> = Vec::new();
    let mut chars = offsets.iter();
    for (index, span) in line.spans.iter().enumerate() {
        let plain = span.style.fg != code.fg;
        for ch in span.content.chars() {
            let offset = chars.next().copied().flatten();
            let escaped = offset.is_some_and(|o| o > 0 && source.as_bytes().get(o - 1) == Some(&b'\\'));
            cells.push((ch, span.style, index, offset, plain && ch == '*' && offset.is_some() && !escaped));
        }
    }
    let star = |i: usize| cells.get(i).is_some_and(|c| c.4);
    let blank = |i: Option<usize>| i.and_then(|i| cells.get(i)).is_none_or(|c| c.0.is_whitespace());
    let mut pairs = Vec::new();
    let mut open: Option<usize> = None;
    let mut i = 0;
    while i < cells.len() {
        if !star(i) {
            i += 1;
            continue;
        }
        let start = i;
        while star(i) {
            i += 1;
        }
        if i - start != 2 || cells.get(start.wrapping_sub(1)).is_some_and(|c| c.0 == '*') {
            continue;
        }
        let closes = !blank(start.checked_sub(1));
        let opens = !blank(Some(i));
        match open {
            Some(at) if closes && start > at + 2 => {
                pairs.push((at, start));
                open = None;
            }
            _ if opens => open = Some(start),
            _ => {}
        }
    }
    if pairs.is_empty() {
        return;
    }
    let mut drop = vec![false; cells.len()];
    for &(at, close) in &pairs {
        for cell in drop
            .iter_mut()
            .enumerate()
            .filter(|(i, _)| (at..at + 2).contains(i) || (close..close + 2).contains(i))
        {
            *cell.1 = true;
        }
        for cell in cells.iter_mut().take(close).skip(at + 2) {
            cell.1 = cell.1.add_modifier(Modifier::BOLD);
        }
    }
    let kept: Vec<_> =
        cells.into_iter().zip(drop).filter_map(|(cell, drop)| (!drop).then_some(cell)).collect();
    *offsets = kept.iter().map(|c| c.3).collect();
    let mut spans: Vec<ratatui::text::Span<'static>> = Vec::new();
    let mut last: Option<(usize, Style)> = None;
    for (ch, style, index, _, _) in kept {
        match spans.last_mut() {
            Some(span) if last == Some((index, style)) => span.content.to_mut().push(ch),
            _ => spans.push(ratatui::text::Span::styled(ch.to_string(), style)),
        }
        last = Some((index, style));
    }
    line.spans = spans;
}

/// Colour the Markdown roles `tui-markdown` styles only by weight or leaves plain, when the
/// palette supplies them. A colour already on the span or its line (headings, quotes,
/// code, links) wins, so nested formatting keeps its container's colour.
fn restyle(text: &mut Text<'static>, kind: BlockKind, surface: &Surface) {
    for line in &mut text.lines {
        if kind == BlockKind::Rule
            && let Some(color) = surface.rule
            && line.style.fg.is_none()
        {
            line.style = line.style.fg(color);
            continue;
        }
        let line_fg = line.style.fg;
        // Links render as `label (destination)`, both in the link style. A host's label
        // colour applies to everything but a destination between ` (` and `)`.
        if let Some(label) = surface.link_text {
            let destination = |spans: &[ratatui::text::Span<'_>], index: usize| {
                index > 0
                    && spans.get(index - 1).is_some_and(|span| span.content == " (")
                    && spans.get(index + 1).is_some_and(|span| span.content == ")")
            };
            for index in 0..line.spans.len() {
                let is_link = line.spans.get(index).is_some_and(|span| span.style.fg == Some(surface.link));
                if is_link
                    && !destination(&line.spans, index)
                    && let Some(span) = line.spans.get_mut(index)
                {
                    span.style = span.style.fg(label);
                }
            }
        }
        for (position, span) in line.spans.iter_mut().enumerate() {
            // Ordered markers are the only spans the renderer colours itself.
            if span.style.fg == Some(Color::LightBlue) && span.content.trim_end().ends_with('.') {
                if let Some(color) = surface.list_number {
                    span.style = span.style.fg(color);
                }
                continue;
            }
            if span.style.fg.is_some() || line_fg.is_some() {
                continue;
            }
            let bullet = kind == BlockKind::List
                && position == 0
                && span.style == Style::new()
                && span.content.trim_start_matches(' ') == "- ";
            let color = if bullet {
                surface.list_item
            } else if span.style.add_modifier.contains(Modifier::BOLD) {
                surface.strong
            } else if span.style.add_modifier.contains(Modifier::ITALIC) {
                surface.emphasis
            } else {
                None
            };
            if let Some(color) = color {
                span.style = span.style.fg(color);
            }
        }
    }
}

fn own(text: Text<'_>) -> Text<'static> {
    let lines = text
        .lines
        .into_iter()
        .map(|line| {
            let spans =
                line.spans.into_iter().map(|s| ratatui::text::Span::styled(s.content.into_owned(), s.style));
            Line::from(spans.collect::<Vec<_>>()).style(line.style)
        })
        .collect::<Vec<_>>();
    Text::from(lines).style(text.style)
}

impl DocLayout {
    /// Render every block once (the expensive part) and lay out for `width`.
    pub(crate) fn build(doc: &Document, width: usize) -> Self {
        let blocks = doc
            .blocks
            .iter()
            .enumerate()
            .map(|(i, block)| {
                let (text, offsets) = render_block(doc, i);
                RenderedBlock { text, offsets, kind: block.kind, rows: Vec::new(), first_row: 0 }
            })
            .collect();
        let mut layout = Self { width: 0, blocks, total_rows: 0 };
        layout.reflow(width);
        layout
    }

    /// Re-wrap for a new width without re-rendering markdown.
    pub(crate) fn reflow(&mut self, width: usize) {
        let width = width.max(1);
        self.width = width;
        let mut row = 0usize;
        for block in &mut self.blocks {
            block.first_row = row;
            let lines = || block.text.lines.iter().zip(&block.offsets);
            block.rows = if block.kind == BlockKind::Table {
                wrap_table(&block.text.lines, &block.offsets, width)
            } else if block.kind.preserves_columns() {
                lines().map(|(l, o)| clip_line(l, o, width)).collect()
            } else {
                lines().flat_map(|(l, o)| wrap_line(l, o, width)).collect()
            };
            row += block.rows.len() + BLOCK_GAP;
        }
        self.total_rows = row.saturating_sub(BLOCK_GAP);
    }

    /// Which block owns a document row (gap rows belong to nobody).
    pub(crate) fn block_at_row(&self, row: usize) -> Option<usize> {
        let idx = self.blocks.partition_point(|b| b.first_row <= row);
        let i = idx.checked_sub(1)?;
        let block = self.blocks.get(i)?;
        (row < block.first_row + block.rows.len()).then_some(i)
    }

    /// The row at document coordinate `row`, if it exists (None for gap rows).
    pub(crate) fn row(&self, row: usize) -> Option<&Row> {
        let block = self.blocks.get(self.block_at_row(row)?)?;
        block.rows.get(row - block.first_row)
    }

    /// First document row on which any cell falls inside `range`.
    pub(crate) fn first_row_in_range(&self, block: usize, range: &Range<usize>) -> Option<usize> {
        let b = self.blocks.get(block)?;
        b.rows
            .iter()
            .position(|r| r.cells.iter().any(|c| c.is_some_and(|o| range.contains(&o))))
            .map(|i| b.first_row + i)
    }

    /// The rendered text under a source range, in the web client's form: rendered
    /// characters whose source offset falls in `range`, blocks joined with no separator.
    ///
    /// The renderer maps a soft line break to nothing, so a break inside a wrapping block
    /// is recovered from the source: when consecutive rendered characters skip over
    /// whitespace in the source, one space is emitted (the DOM renders a soft break as a
    /// space). Code and tables keep their newlines.
    pub(crate) fn rendered_in_range(&self, source: &str, range: &Range<usize>) -> String {
        let mut out = String::new();
        for block in &self.blocks {
            let break_char = if block.kind.preserves_columns() { '\n' } else { ' ' };
            let mut last_offset: Option<usize> = None;
            let chars = block.text.lines.iter().zip(&block.offsets).flat_map(|(line, offsets)| {
                line.spans.iter().flat_map(|s| s.content.chars()).zip(offsets.iter())
            });
            for (ch, offset) in chars {
                let Some(offset) = offset.filter(|o| range.contains(o)) else { continue };
                if let Some(prev) = last_offset
                    && let Some(skipped) = source.get(prev..offset)
                    && skipped.chars().any(char::is_whitespace)
                    && !out.ends_with(char::is_whitespace)
                {
                    out.push(break_char);
                }
                out.push(ch);
                last_offset = Some(offset + ch.len_utf8());
            }
        }
        out
    }
}

#[cfg(test)]
#[allow(clippy::expect_used, reason = "tests assert by panicking")]
mod tests {
    use super::*;

    #[test]
    fn host_markdown_roles_color_plain_spans_and_keep_container_colors() {
        let surface = Surface {
            strong: Some(Color::Rgb(1, 0, 0)),
            emphasis: Some(Color::Rgb(2, 0, 0)),
            list_item: Some(Color::Rgb(3, 0, 0)),
            list_number: Some(Color::Rgb(4, 0, 0)),
            rule: Some(Color::Rgb(5, 0, 0)),
            ..Surface::DEFAULT
        };
        let fg = |source: &str, kind: BlockKind| {
            let mut text = own(tui_markdown::from_str_with_options(source, &Options::new(Styles)));
            restyle(&mut text, kind, &surface);
            text.lines
                .iter()
                .flat_map(|line| {
                    line.spans
                        .iter()
                        .map(move |span| (span.content.to_string(), span.style.fg.or(line.style.fg)))
                })
                .filter(|(content, _)| !content.trim().is_empty())
                .collect::<Vec<_>>()
        };
        let para = fg("plain **strong** *soft*\n", BlockKind::Paragraph);
        assert_eq!(para.first().map(|(_, color)| *color), Some(None));
        assert!(para.contains(&("strong".to_owned(), Some(Color::Rgb(1, 0, 0)))));
        assert!(para.contains(&("soft".to_owned(), Some(Color::Rgb(2, 0, 0)))));
        let bullets = fg("- one\n  - two\n", BlockKind::List);
        assert_eq!(bullets.iter().filter(|(_, c)| *c == Some(Color::Rgb(3, 0, 0))).count(), 2);
        let numbers = fg("1. one\n2. two\n", BlockKind::List);
        assert_eq!(numbers.iter().filter(|(_, c)| *c == Some(Color::Rgb(4, 0, 0))).count(), 2);
        assert_eq!(fg("---\n", BlockKind::Rule), [("---".to_owned(), Some(Color::Rgb(5, 0, 0)))]);
        let link_surface = Surface { link_text: Some(Color::Rgb(6, 0, 0)), ..surface };
        let mut text = own(tui_markdown::from_str_with_options(
            "| A |\n|---|\n| [Doc](https://x.y) |\n",
            &Options::new(Styles),
        ));
        restyle(&mut text, BlockKind::Table, &link_surface);
        let spans: Vec<_> = text.lines.iter().flat_map(|line| line.spans.iter()).collect();
        let color = |content: &str| {
            spans.iter().find(|span| span.content.trim() == content).and_then(|span| span.style.fg)
        };
        assert_eq!(color("Doc"), Some(Color::Rgb(6, 0, 0)));
        assert_eq!(color("https://x.y"), Some(surface.link));
        assert_eq!(color("A"), Some(palette().heading));
        let heading = fg("## Title **bold**\n", BlockKind::Heading);
        assert!(heading.iter().all(|(_, c)| *c == Some(palette().heading)));
    }

    #[test]
    fn rendered_text_strips_markup_and_joins_blocks_without_separator() {
        let doc = Document::parse("Ship the **login page**\nby Friday.\n\nNext para.\n".to_owned());
        let layout = DocLayout::build(&doc, 80);
        let whole = 0..doc.source.len();
        assert_eq!(layout.rendered_in_range(&doc.source, &whole), "Ship the login page by Friday.Next para.");
        let bold = doc.source.find("**login").expect("present");
        let bold_range = bold..bold + "**login page**".len();
        assert_eq!(layout.rendered_in_range(&doc.source, &bold_range), "login page");
    }

    #[test]
    fn strong_after_punctuation_renders_bold_and_keeps_its_source_map() {
        let doc = Document::parse(
            "- **题库：**把矛盾的题反馈给题库。\n- **Note:**text and **ok** `**code:**x` \\*\\*lit:\\*\\*y\n"
                .to_owned(),
        );
        let layout = DocLayout::build(&doc, 120);
        let block = layout.blocks.first().expect("a list");
        let bold = |line: &Line<'_>| {
            line.spans
                .iter()
                .filter(|s| s.style.add_modifier.contains(Modifier::BOLD))
                .map(|s| s.content.to_string())
                .collect::<Vec<_>>()
        };
        let first = block.text.lines.first().expect("first item");
        assert_eq!(first.to_string(), "- 题库：把矛盾的题反馈给题库。");
        assert_eq!(bold(first), ["题库："]);
        let second = block.text.lines.get(1).expect("second item");
        assert_eq!(second.to_string(), "- Note:text and ok **code:**x **lit:**y");
        assert_eq!(bold(second), ["Note:", "ok"]);
        for (line, offsets) in block.text.lines.iter().zip(&block.offsets) {
            assert_eq!(line.to_string().chars().count(), offsets.len());
            for (ch, offset) in line.to_string().chars().zip(offsets) {
                if let Some(o) = offset {
                    assert!(doc.source.get(*o..).is_some_and(|s| s.starts_with(ch)), "{ch:?} maps to {o}");
                }
            }
        }
        let quote = doc.source.find("**题库").expect("present");
        let range = quote..quote + "**题库：**把".len();
        assert_eq!(layout.rendered_in_range(&doc.source, &range), "题库：把");
    }

    #[test]
    fn every_cell_of_a_long_table_maps_to_its_source() {
        let doc = Document::parse(
            "| Item | Status | Next step |\n|---|---|---|\n\
| A. Four changes from 3/7 (release checklist handoff, the 3/4 planning call, the 3/6 search demo, \
the 3/4-3/7 progress review and rollout advice) | Scope partly confirmed; never added to the \
draft | 1.0d design + 1.0d build + 1.0d review + 2.5d rollout = **5.5d** |\n\
| B. 3/14 cache troubleshooting and the `api.example.com` proxy | Owner and priority not set | Your call |\n\
| C. 3/19-20 export access in the admin panel (read and write) | Agreed at 1.0d, done once it's \
tested; it's live, but QA hasn't finished acceptance testing | Close it now, or wait for the next sprint |\n\
| D. 3/21 lookup and report tools in the CLI; 3/23 plugin consolidation | Marked \"not confirmed\" | Your call |\n"
                .to_owned(),
        );
        let layout = DocLayout::build(&doc, 100);
        let table = layout.blocks.iter().find(|b| b.kind == BlockKind::Table).expect("a table");
        let mut cells = 0;
        for row in &table.rows {
            let text: String = row.line.spans.iter().map(|s| s.content.as_ref()).collect();
            for (ch, offset) in text.chars().zip(&row.cells) {
                if ch.is_alphanumeric() {
                    let source = offset.and_then(|o| doc.source.get(o..));
                    assert!(source.is_some_and(|s| s.starts_with(ch)), "{ch:?} is unmapped in {text:?}");
                    cells += 1;
                }
            }
        }
        assert!(cells > 300, "only {cells} cells checked");
    }
}
