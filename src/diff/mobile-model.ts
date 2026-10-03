import { INSERT_AROUND_REASON, hunkHasBothSides, type RangeChunk } from './hunk-text';

export interface SummaryChange {
	fromA: number;
	toA: number;
	fromB: number;
	toB: number;
}

export interface SummaryChunk extends RangeChunk {
	changes?: readonly SummaryChange[];
}

export interface SummarySpan {
	kind: 'same' | 'delete' | 'insert';
	text: string;
	chunk: number | null;
}

export interface SummaryDocument {
	spans: SummarySpan[];
	removed: number;
	added: number;
}

export interface BarActions {
	replace: boolean;
	above: boolean;
	below: boolean;
	delete: boolean;
}

export type MobileWrite =
	| 'replace-left'
	| 'replace-right'
	| 'insert-above-left'
	| 'insert-below-left'
	| 'insert-above-right'
	| 'insert-below-right'
	| 'delete-left'
	| 'delete-right';

export function chunkSlice(doc: string, from: number, to: number): string {
	if (from >= to) return '';
	const start = Math.max(0, Math.min(from, doc.length));
	const end = Math.max(start, Math.min(to, doc.length));
	return doc.slice(start, end);
}

export function buildSummary(left: string, right: string, chunks: readonly SummaryChunk[]): SummaryDocument {
	const spans: SummarySpan[] = [];
	let cursor = 0;
	let removed = 0;
	let added = 0;
	for (let index = 0; index < chunks.length; index++) {
		const chunk = chunks[index];
		if (!chunk) continue;
		const start = Math.max(0, Math.min(chunk.fromA, left.length));
		if (start > cursor) spans.push({ kind: 'same', text: left.slice(cursor, start), chunk: null });
		const deleted = chunkSlice(left, chunk.fromA, chunk.toA);
		const inserted = chunkSlice(right, chunk.fromB, chunk.toB);
		if (deleted) spans.push({ kind: 'delete', text: deleted, chunk: index });
		if (inserted) spans.push({ kind: 'insert', text: inserted, chunk: index });
		const counts = tokenCounts(chunk, deleted, inserted);
		removed += counts.removed;
		added += counts.added;
		cursor = Math.max(cursor, Math.min(left.length, Math.max(start, chunk.toA)));
	}
	if (cursor < left.length) spans.push({ kind: 'same', text: left.slice(cursor), chunk: null });
	return { spans, removed, added };
}

function tokenCounts(chunk: SummaryChunk, deleted: string, inserted: string): { removed: number; added: number } {
	if (chunk.changes && chunk.changes.length > 0) {
		let removed = 0;
		let added = 0;
		for (const change of chunk.changes) {
			removed += Math.max(0, change.toA - change.fromA);
			added += Math.max(0, change.toB - change.fromB);
		}
		return { removed, added };
	}
	return { removed: visibleLength(deleted), added: visibleLength(inserted) };
}

function visibleLength(text: string): number {
	return text.endsWith('\n') ? Math.max(0, text.length - 1) : text.length;
}

export function barActions(chunk: RangeChunk | null, side: 'a' | 'b'): BarActions {
	if (!chunk) return { replace: false, above: false, below: false, delete: false };
	const empty = side === 'a' ? chunk.fromA === chunk.toA : chunk.fromB === chunk.toB;
	const around = hunkHasBothSides(chunk);
	return { replace: true, above: around, below: around, delete: !empty };
}

export function actionTip(key: keyof BarActions, actions: BarActions, label: string): string {
	if ((key === 'above' || key === 'below') && actions.replace && !actions[key]) return INSERT_AROUND_REASON;
	return label;
}

/** The file bar does not describe the hunk or the armed edit. Disabled buttons keep their own labels. */
export function cursorCaption(
	_armed: MobileWrite | null,
	_left: string,
	_right: string,
	_chunk: RangeChunk | null,
): string {
	return '';
}

export interface ScrollBlock {
	from: number;
	to: number;
	top: number;
	height: number;
}

function clampUnit(value: number): number {
	if (value <= 0) return 0;
	if (value >= 1) return 1;
	return value;
}

/**
 * Document position at the viewport top. A wrapped paragraph is one block,
 * so the position has to move through the block instead of staying on its first character.
 */
export function docPosAtScroll(scrollTop: number, block: ScrollBlock): number {
	const span = block.to - block.from;
	if (span <= 0 || block.height <= 0) return block.from;
	const fraction = clampUnit((scrollTop - block.top) / block.height);
	return block.from + fraction * span;
}

/** Scroll offset that puts `pos` at the top of the viewport, partway through its block. */
export function scrollTopForPos(pos: number, block: ScrollBlock): number {
	const span = block.to - block.from;
	if (span <= 0 || block.height <= 0) return block.top;
	const fraction = clampUnit((pos - block.from) / span);
	return block.top + fraction * block.height;
}

/** Map a document offset on one side onto the other side, through unchanged text and chunks. */
export function alignedDocPos(chunks: readonly RangeChunk[], fromSide: 'a' | 'b', pos: number): number {
	let a = 0;
	let b = 0;
	for (const chunk of chunks) {
		const fromStart = fromSide === 'a' ? chunk.fromA : chunk.fromB;
		const fromEnd = fromSide === 'a' ? chunk.toA : chunk.toB;
		const baseFrom = fromSide === 'a' ? a : b;
		const baseTo = fromSide === 'a' ? b : a;
		if (pos < fromStart) return Math.max(0, baseTo + (pos - baseFrom));
		if (pos < fromEnd) {
			const span = fromEnd - fromStart;
			const toStart = fromSide === 'a' ? chunk.fromB : chunk.fromA;
			const toEnd = fromSide === 'a' ? chunk.toB : chunk.toA;
			const ratio = span <= 0 ? 0 : (pos - fromStart) / span;
			return toStart + ratio * (toEnd - toStart);
		}
		a = chunk.toA;
		b = chunk.toB;
	}
	const baseFrom = fromSide === 'a' ? a : b;
	const baseTo = fromSide === 'a' ? b : a;
	return Math.max(0, baseTo + (pos - baseFrom));
}

function chunkEdge(chunk: RangeChunk, side: 'a' | 'b'): { from: number; to: number } {
	return side === 'a' ? { from: chunk.fromA, to: chunk.toA } : { from: chunk.fromB, to: chunk.toB };
}

function covers(chunk: RangeChunk, side: 'a' | 'b', pos: number): boolean {
	const edge = chunkEdge(chunk, side);
	if (edge.from === edge.to) return pos === edge.from;
	return pos >= edge.from && pos < edge.to;
}

/** Index of the chunk prev/next should land on. -1 when there is nowhere to go. */
export function stepChunk(chunks: readonly RangeChunk[], side: 'a' | 'b', pos: number, dir: 1 | -1): number {
	if (dir > 0) {
		for (let index = 0; index < chunks.length; index++) {
			const chunk = chunks[index];
			if (!chunk) continue;
			if (covers(chunk, side, pos)) return index + 1 < chunks.length ? index + 1 : -1;
			if (pos < chunkEdge(chunk, side).from) return index;
		}
		return -1;
	}
	for (let index = chunks.length - 1; index >= 0; index--) {
		const chunk = chunks[index];
		if (!chunk) continue;
		if (covers(chunk, side, pos)) return index - 1;
		const edge = chunkEdge(chunk, side);
		if (pos > edge.from) return index;
	}
	return -1;
}
