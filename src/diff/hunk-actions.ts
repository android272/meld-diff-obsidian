import { EditorView } from '@codemirror/view';
import { Notice } from 'obsidian';
import { deleteEdit, hunkHasBothSides, hunkText, replaceEdit, type RangeChunk, type TextEdit } from './hunk-text';

export type HunkAction =
	| 'replace-left'
	| 'replace-right'
	| 'insert-above-left'
	| 'insert-below-left'
	| 'insert-above-right'
	| 'insert-below-right'
	| 'delete-left'
	| 'delete-right';

export const HUNK_ACTION_LABELS: Record<HunkAction, string> = {
	'replace-left': 'Replace A with B',
	'replace-right': 'Replace B with A',
	'insert-above-left': 'Insert B above A',
	'insert-below-left': 'Insert B below A',
	'insert-above-right': 'Insert A above B',
	'insert-below-right': 'Insert A below B',
	'delete-left': 'Delete hunk on A',
	'delete-right': 'Delete hunk on B',
};

function dispatchEdit(view: EditorView, edit: TextEdit): void {
	if (edit.from === edit.to && edit.insert === '') return;
	view.dispatch({ changes: edit, userEvent: 'input' });
}

export function applyHunkAction(action: HunkAction, left: EditorView, right: EditorView, chunk: RangeChunk): void {
	if (action.startsWith('insert-') && !hunkHasBothSides(chunk)) return;
	const leftDoc = left.state.doc.toString();
	const rightDoc = right.state.doc.toString();
	const leftBreak = left.state.lineBreak || '\n';
	const rightBreak = right.state.lineBreak || '\n';
	try {
		switch (action) {
			case 'replace-left':
				dispatchEdit(left, replaceEdit(rightDoc, chunk.fromB, chunk.toB, leftDoc, chunk.fromA, chunk.toA, rightBreak));
				break;
			case 'replace-right':
				dispatchEdit(right, replaceEdit(leftDoc, chunk.fromA, chunk.toA, rightDoc, chunk.fromB, chunk.toB, leftBreak));
				break;
			case 'insert-above-left':
				dispatchEdit(left, { from: chunk.fromA, to: chunk.fromA, insert: hunkText(rightDoc, chunk.fromB, chunk.toB, rightBreak) });
				break;
			case 'insert-below-left': {
				const pos = Math.min(leftDoc.length, chunk.toA);
				dispatchEdit(left, { from: pos, to: pos, insert: hunkText(rightDoc, chunk.fromB, chunk.toB, rightBreak) });
				break;
			}
			case 'insert-above-right':
				dispatchEdit(right, { from: chunk.fromB, to: chunk.fromB, insert: hunkText(leftDoc, chunk.fromA, chunk.toA, leftBreak) });
				break;
			case 'insert-below-right': {
				const pos = Math.min(rightDoc.length, chunk.toB);
				dispatchEdit(right, { from: pos, to: pos, insert: hunkText(leftDoc, chunk.fromA, chunk.toA, leftBreak) });
				break;
			}
			case 'delete-left':
				if (chunk.fromA !== chunk.toA) dispatchEdit(left, deleteEdit(leftDoc, chunk.fromA, chunk.toA));
				break;
			case 'delete-right':
				if (chunk.fromB !== chunk.toB) dispatchEdit(right, deleteEdit(rightDoc, chunk.fromB, chunk.toB));
				break;
		}
	} catch (error) {
		console.error('Meld Diff: hunk action failed', error);
		new Notice('Meld Diff could not apply that change.');
	}
}

export function chunkAtCursor(chunks: readonly RangeChunk[], side: 'a' | 'b', view: EditorView): RangeChunk | null {
	const doc = view.state.doc;
	const pos = view.state.selection.main.head;
	let empty: RangeChunk | null = null;
	for (const chunk of chunks) {
		const from = side === 'b' ? chunk.fromB : chunk.fromA;
		const to = side === 'b' ? chunk.toB : chunk.toA;
		if (from !== to && pos >= from && (pos < to || (pos === doc.length && to >= doc.length))) return chunk;
		if (from === to && !empty) {
			const cursorLine = doc.lineAt(Math.min(pos, doc.length)).number;
			const boundary = doc.lineAt(Math.min(Math.max(from, 0), doc.length)).number;
			if (cursorLine === boundary) empty = chunk;
		}
	}
	return empty;
}
