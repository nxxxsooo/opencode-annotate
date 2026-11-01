//! A mouse selection in document coordinates, and its conversion to a source range.

use std::ops::Range;

use unicode_width::UnicodeWidthChar;

use crate::doc::{BlockKind, Document};
use crate::layout::DocLayout;
use crate::wrap::Row;

/// The table cell a selection started in, in document coordinates. A cell is one
/// contiguous run of source, so a selection held inside it quotes only that cell.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct TableCell {
    /// First and last screen row of the cell (a wrapped cell spans several).
    rows: (usize, usize),
    /// Columns of the `│` on each side of the cell.
    bars: (usize, usize),
    /// Screen rows of the whole table, end exclusive.
    table: (usize, usize),
}

/// Anchor and head are (row, column) in document coordinates.
#[derive(Debug, Clone, Copy)]
pub(super) struct Selection {
    anchor: (usize, usize),
    head: (usize, usize),
    cell: Option<TableCell>,
    pub(super) dragging: bool,
}

impl Selection {
    #[cfg(test)]
    pub(crate) fn anchor(&self) -> (usize, usize) {
        self.anchor
    }

    pub(super) fn start(at: (usize, usize), cell: Option<TableCell>) -> Self {
        Self { anchor: at, head: at, cell, dragging: true }
    }

    pub(super) fn finished(anchor: (usize, usize), head: (usize, usize), cell: Option<TableCell>) -> Self {
        Self { anchor, head, cell, dragging: false }
    }

    pub(super) fn set_head(&mut self, head: (usize, usize)) {
        self.head = head;
    }

    /// The anchor's cell while the head stays in its column of the table. Moving up or
    /// down past the cell keeps the selection in it; moving to another column or out of
    /// the table falls back to selecting whole rows.
    fn held_cell(&self) -> Option<TableCell> {
        let cell = self.cell?;
        let (row, col) = self.head;
        let in_table = row >= cell.table.0 && row < cell.table.1;
        let in_column = col >= cell.bars.0 && col <= cell.bars.1;
        (in_table && in_column).then_some(cell)
    }

    fn head(&self) -> (usize, usize) {
        match self.held_cell() {
            Some(cell) => (self.head.0.clamp(cell.rows.0, cell.rows.1), self.head.1),
            None => self.head,
        }
    }

    pub(super) fn ordered(&self) -> ((usize, usize), (usize, usize)) {
        let head = self.head();
        if self.anchor <= head { (self.anchor, head) } else { (head, self.anchor) }
    }

    pub(super) fn is_empty(&self) -> bool {
        self.anchor == self.head()
    }

    /// Columns of `row` covered by the selection, if any.
    pub(super) fn columns_on(&self, row: usize, row_width: usize) -> Option<Range<usize>> {
        let (a, b) = self.ordered();
        if row < a.0 || row > b.0 {
            return None;
        }
        let (left, right) = self.held_cell().map_or((0, row_width), |cell| (cell.bars.0 + 1, cell.bars.1));
        let start = if row == a.0 { a.1.max(left) } else { left };
        let end = if row == b.0 { (b.1 + 1).min(right) } else { right };
        (start < end).then_some(start..end)
    }
}

/// The table cell under `at`, if `at` is inside one.
pub(super) fn table_cell_at(layout: &DocLayout, doc: &Document, at: (usize, usize)) -> Option<TableCell> {
    let index = layout.block_at_row(at.0)?;
    if doc.blocks.get(index)?.kind != BlockKind::Table {
        return None;
    }
    let block = layout.blocks.get(index)?;
    let local = at.0 - block.first_row;
    let bars = bar_columns(block.rows.get(local)?);
    let left = *bars.iter().rev().find(|&&bar| bar < at.1)?;
    let right = *bars.iter().find(|&&bar| bar > at.1)?;
    // Screen rows of one source row share its `│` layout and its source line.
    let line = |row: &Row| {
        let offset = row.cells.iter().flatten().next().copied()?;
        Some(doc.source.get(..offset)?.rfind('\n').map_or(0, |i| i + 1))
    };
    let anchor_line = line(block.rows.get(local)?);
    let same = |i: usize| {
        anchor_line.is_some()
            && block.rows.get(i).is_some_and(|row| bar_columns(row) == bars && line(row) == anchor_line)
    };
    let mut first = local;
    while first > 0 && same(first - 1) {
        first -= 1;
    }
    let mut last = local;
    while same(last + 1) {
        last += 1;
    }
    let base = block.first_row;
    Some(TableCell {
        rows: (base + first, base + last),
        bars: (left, right),
        table: (base, base + block.rows.len()),
    })
}

/// Screen columns holding a `│` in a rendered row.
fn bar_columns(row: &Row) -> Vec<usize> {
    let mut column = 0;
    let mut bars = Vec::new();
    for ch in row.line.spans.iter().flat_map(|span| span.content.chars()) {
        if ch == '│' {
            bars.push(column);
        }
        column += ch.width().unwrap_or(0);
    }
    bars
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn columns_span_rows_in_either_drag_direction() {
        let sel = Selection::finished((5, 2), (3, 5), None);
        assert_eq!(sel.columns_on(2, 80), None);
        assert_eq!(sel.columns_on(3, 80), Some(5..80));
        assert_eq!(sel.columns_on(4, 80), Some(0..80));
        assert_eq!(sel.columns_on(5, 80), Some(0..3));
    }

    #[test]
    fn a_selection_inside_a_table_cell_keeps_to_its_column_and_rows() {
        let cell = TableCell { rows: (3, 4), bars: (20, 40), table: (0, 10) };
        let sel = Selection::finished((3, 25), (4, 30), Some(cell));
        assert_eq!(sel.columns_on(3, 60), Some(25..40));
        assert_eq!(sel.columns_on(4, 60), Some(21..31));
        // Dragging further down the same column stays on the cell's last row.
        let sel = Selection::finished((3, 25), (8, 30), Some(cell));
        assert_eq!(sel.ordered(), ((3, 25), (4, 30)));
        assert_eq!(sel.columns_on(5, 60), None);
        // Moving into another column selects whole rows again.
        let sel = Selection::finished((3, 25), (4, 45), Some(cell));
        assert_eq!(sel.columns_on(3, 60), Some(25..60));
        assert_eq!(sel.columns_on(4, 60), Some(0..46));
    }
}
