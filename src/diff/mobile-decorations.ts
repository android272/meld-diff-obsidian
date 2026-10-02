import { Facet, RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { chunkKind, type RangeChunk } from './hunk-text';
import type { SummaryChange } from './mobile-model';

export interface MobileChunk extends RangeChunk {
	changes?: readonly SummaryChange[];
}

export interface MobileArm {
	from: number;
	to: number;
	caret: boolean;
}

export const mobileChunks = Facet.define<readonly MobileChunk[] | null, readonly MobileChunk[] | null>({
	combine: (values) => (values.length ? values[values.length - 1] ?? null : null),
});

export const mobileSide = Facet.define<'a' | 'b', 'a' | 'b'>({
	combine: (values) => values[values.length - 1] ?? 'a',
});

export const mobileIntra = Facet.define<boolean, boolean>({
	combine: (values) => values[values.length - 1] ?? true,
});

export const mobileArm = Facet.define<MobileArm | null, MobileArm | null>({
	combine: (values) => (values.length ? values[values.length - 1] ?? null : null),
});

const changeLine = Decoration.line({ class: 'meld-hunk-change' });
const blankDelete = Decoration.line({ class: 'meld-mobile-blank-delete' });
const blankInsert = Decoration.line({ class: 'meld-mobile-blank-insert' });
const deleteMark = Decoration.mark({ class: 'meld-mobile-delete' });
const insertMark = Decoration.mark({ class: 'meld-mobile-insert' });
const tokenMark = Decoration.mark({ class: 'cm-changedText' });
const armRange = Decoration.mark({ class: 'meld-arm-range' });
const armCaret = Decoration.line({ class: 'meld-arm-caret' });

type Doc = {
	length: number;
	lineAt: (pos: number) => { from: number; to: number };
	sliceString: (from: number, to: number) => string;
};

function signature(state: ViewUpdate['state']): string {
	const chunks = state.facet(mobileChunks);
	const arm = state.facet(mobileArm);
	const body = chunks ? chunks.map((chunk) => `${chunk.fromA},${chunk.toA},${chunk.fromB},${chunk.toB},${chunk.changes?.length ?? 0}`).join(';') : '';
	const armKey = arm ? `${arm.from},${arm.to},${arm.caret ? 1 : 0}` : '';
	return `${state.facet(mobileSide)}:${state.facet(mobileIntra) ? 1 : 0}:${body}:${armKey}:${state.doc.length}`;
}

function textEnd(doc: Doc, from: number, to: number): number {
	if (from >= to) return from;
	let end = Math.min(doc.length, Math.max(from, to));
	if (end > from && doc.sliceString(end - 1, end) === '\n') end -= 1;
	return end;
}

function linePoints(doc: Doc, from: number, to: number, blanksOnly: boolean): number[] {
	const points: number[] = [];
	if (from >= to || from > doc.length) return points;
	const limit = Math.min(Math.max(from, to), doc.length);
	let pos = Math.max(0, Math.min(from, doc.length));
	while (pos < limit) {
		const line = doc.lineAt(pos);
		if (!blanksOnly || line.from === line.to) points.push(line.from);
		const next = line.to + 1;
		if (next <= pos) break;
		pos = next;
	}
	return points;
}

function buildLines(view: EditorView): DecorationSet {
	const chunks = view.state.facet(mobileChunks);
	if (!chunks) return Decoration.none;
	const side = view.state.facet(mobileSide);
	const doc = view.state.doc;
	const points: Array<{ at: number; deco: Decoration }> = [];
	for (const chunk of chunks) {
		const from = side === 'b' ? chunk.fromB : chunk.fromA;
		const to = side === 'b' ? chunk.toB : chunk.toA;
		if (from === to || from > doc.length) continue;
		const kind = chunkKind(chunk);
		if (kind === 'change') {
			for (const at of linePoints(doc, from, to, false)) points.push({ at, deco: changeLine });
		} else if ((kind === 'delete' && side === 'a') || (kind === 'insert' && side === 'b')) {
			const deco = kind === 'delete' ? blankDelete : blankInsert;
			for (const at of linePoints(doc, from, to, true)) points.push({ at, deco });
		}
	}
	points.sort((a, b) => a.at - b.at);
	const builder = new RangeSetBuilder<Decoration>();
	let last = -1;
	for (const point of points) {
		if (point.at <= last || point.at > doc.length) continue;
		builder.add(point.at, point.at, point.deco);
		last = point.at;
	}
	return builder.finish();
}

function buildArm(view: EditorView): DecorationSet {
	const arm = view.state.facet(mobileArm);
	if (!arm) return Decoration.none;
	const doc = view.state.doc;
	const builder = new RangeSetBuilder<Decoration>();
	if (arm.caret) {
		const at = Math.max(0, Math.min(arm.from, doc.length));
		const line = doc.lineAt(at);
		builder.add(line.from, line.from, armCaret);
		return builder.finish();
	}
	const from = Math.max(0, Math.min(arm.from, doc.length));
	const to = Math.max(from, Math.min(arm.to, doc.length));
	if (from >= to) return Decoration.none;
	builder.add(from, to, armRange);
	return builder.finish();
}

function pushMark(marks: Array<{ from: number; to: number; deco: Decoration }>, doc: Doc, from: number, to: number, deco: Decoration): void {
	const start = Math.max(0, Math.min(from, doc.length));
	const end = Math.max(start, Math.min(to, doc.length));
	if (start >= end) return;
	marks.push({ from: start, to: end, deco });
}

function buildMarks(view: EditorView): DecorationSet {
	const chunks = view.state.facet(mobileChunks);
	if (!chunks) return Decoration.none;
	const side = view.state.facet(mobileSide);
	const intra = view.state.facet(mobileIntra);
	const doc = view.state.doc;
	const marks: Array<{ from: number; to: number; deco: Decoration }> = [];
	for (const chunk of chunks) {
		const from = side === 'b' ? chunk.fromB : chunk.fromA;
		const to = side === 'b' ? chunk.toB : chunk.toA;
		const kind = chunkKind(chunk);
		if ((kind === 'delete' && side === 'a') || (kind === 'insert' && side === 'b')) {
			pushMark(marks, doc, from, textEnd(doc, from, to), kind === 'delete' ? deleteMark : insertMark);
			continue;
		}
		if (kind !== 'change' || !intra || !chunk.changes) continue;
		const base = from;
		for (const change of chunk.changes) {
			const changeFrom = base + (side === 'b' ? change.fromB : change.fromA);
			const changeTo = base + (side === 'b' ? change.toB : change.toA);
			pushMark(marks, doc, changeFrom, changeTo, tokenMark);
		}
	}
	marks.sort((a, b) => a.from - b.from || a.to - b.to);
	const builder = new RangeSetBuilder<Decoration>();
	let lastTo = -1;
	for (const mark of marks) {
		if (mark.from < lastTo) continue;
		builder.add(mark.from, mark.to, mark.deco);
		lastTo = mark.to;
	}
	return builder.finish();
}

function plugin(build: (view: EditorView) => DecorationSet) {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			private key: string;
			constructor(view: EditorView) {
				this.key = signature(view.state);
				this.decorations = build(view);
			}
			update(update: ViewUpdate) {
				const key = signature(update.state);
				if (update.docChanged || key !== this.key) {
					this.key = key;
					this.decorations = build(update.view);
				}
			}
		},
		{ decorations: (value) => value.decorations },
	);
}

export function mobileDecorationExtensions(): Extension {
	return [plugin(buildLines), plugin(buildMarks), plugin(buildArm)];
}
