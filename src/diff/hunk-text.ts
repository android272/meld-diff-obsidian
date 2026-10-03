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

/** Prepend and append need a real hunk on both sides. A point on one side has nothing to insert around. */
export function hunkHasBothSides(chunk: RangeChunk): boolean {
	return chunk.fromA !== chunk.toA && chunk.fromB !== chunk.toB;
}

/**
 * Whether a hunk button or command is allowed to write.
 * Replace is always allowed. Insert needs text on both sides. Delete needs text on the side it clears.
 */
export function hunkWriteAllowed(action: string, chunk: RangeChunk): boolean {
	if (action.startsWith('insert-')) return hunkHasBothSides(chunk);
	if (action === 'delete-left') return chunk.fromA !== chunk.toA;
	if (action === 'delete-right') return chunk.fromB !== chunk.toB;
	return true;
}

/** Which read-only notice applies, if the action writes a locked side. The wording stays with the caller. */
export function readOnlyNotice(
	action: string,
	readOnly: { left: boolean; right: boolean },
	messages: { left: string; right: string },
): string | null {
	if (action.endsWith('left')) return readOnly.left ? messages.left : null;
	return readOnly.right ? messages.right : null;
}

/** Copy-all walks changes from the end so earlier offsets stay valid. */
export function copyAllSteps<T extends RangeChunk>(
	chunks: readonly T[],
	direction: 'to-left' | 'to-right',
): Array<{ action: 'replace-left' | 'replace-right'; chunk: T }> {
	const action = direction === 'to-left' ? 'replace-left' : 'replace-right';
	const steps: Array<{ action: 'replace-left' | 'replace-right'; chunk: T }> = [];
	for (let index = chunks.length - 1; index >= 0; index--) {
		const chunk = chunks[index];
		if (chunk) steps.push({ action, chunk });
	}
	return steps;
}

export const INSERT_AROUND_REASON = 'Nothing on the other side to insert around';

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
