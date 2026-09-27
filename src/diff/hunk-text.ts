export interface TextEdit {
	from: number;
	to: number;
	insert: string;
}

export interface RangeChunk {
	fromA: number;
	toA: number;
	fromB: number;
	toB: number;
}

export type ChunkKind = 'insert' | 'delete' | 'change';

export function chunkKind(chunk: RangeChunk): ChunkKind {
	const emptyA = chunk.fromA === chunk.toA;
	const emptyB = chunk.fromB === chunk.toB;
	if (emptyA && !emptyB) return 'insert';
	if (emptyB && !emptyA) return 'delete';
	return 'change';
}

/**
 * Text copied from a chunk. `to` may point one past the last line, matching
 * CodeMirror's Chunk contract, so the final extra unit is dropped and a
 * line break is restored.
 */
export function hunkText(src: string, srcFrom: number, srcTo: number, lineBreak = '\n'): string {
	if (srcFrom === srcTo) return '';
	const sliceEnd = Math.min(src.length, Math.max(srcFrom, srcTo - 1));
	let text = src.slice(Math.max(0, srcFrom), Math.max(0, sliceEnd));
	if (!text.endsWith('\n') && !text.endsWith('\r\n')) text += lineBreak;
	return text;
}

/** Replace the destination hunk with the source hunk. Same newline rule as MergeView's revert control. */
export function replaceEdit(
	src: string,
	srcFrom: number,
	srcTo: number,
	dest: string,
	destFrom: number,
	destTo: number,
	lineBreak = '\n',
): TextEdit {
	const from = Math.max(0, Math.min(destFrom, dest.length));
	const to = Math.max(from, Math.min(dest.length, destTo));
	if (srcFrom === srcTo) return { from, to, insert: '' };
	const sliceEnd = Math.min(src.length, Math.max(srcFrom, srcTo - 1));
	let insert = src.slice(Math.max(0, srcFrom), Math.max(0, sliceEnd));
	if (destTo <= dest.length) insert += lineBreak;
	return { from, to, insert };
}

/** Delete a hunk. If the range is mid-line on both sides, keep one newline so the neighbors do not glue together. */
export function deleteEdit(dest: string, destFrom: number, destTo: number): TextEdit {
	const from = Math.max(0, Math.min(destFrom, dest.length));
	const to = Math.max(from, Math.min(dest.length, destTo));
	const prev = from > 0 ? dest[from - 1] : '\n';
	const next = to < dest.length ? dest[to] : '\n';
	const prevBreak = from === 0 || prev === '\n';
	const nextBreak = to === dest.length || next === '\n';
	const insert = !prevBreak && !nextBreak ? '\n' : '';
	return { from, to, insert };
}

export function applyEdit(doc: string, edit: TextEdit): string {
	return doc.slice(0, edit.from) + edit.insert + doc.slice(edit.to);
}
