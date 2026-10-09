import { getChunks } from '@codemirror/merge';
import { EditorState, Facet, RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { mobileChunks, mobileSide } from './mobile-decorations';

const showAllWhitespace = Facet.define<boolean, boolean>({
	combine: (values) => values[values.length - 1] ?? false,
});

const spaceMark = Decoration.mark({ class: 'cm-ws-space' });
const tabMark = Decoration.mark({ class: 'cm-ws-tab' });

class EndOfLineWidget extends WidgetType {
	toDOM(): HTMLElement {
		return createSpan({ cls: 'cm-ws-eol', text: '↵', attr: { 'aria-hidden': 'true' } });
	}
	ignoreEvent(): boolean {
		return true;
	}
}

const endOfLine = Decoration.widget({ widget: new EndOfLineWidget(), side: -1 });

function chunkInfo(state: EditorState): { chunks: readonly { fromA: number; toA: number; fromB: number; toB: number }[]; side: 'a' | 'b' | null } | null {
	const info = getChunks(state);
	if (info) return info;
	const chunks = state.facet(mobileChunks);
	if (!chunks) return null;
	return { chunks, side: state.facet(mobileSide) };
}

function changedRanges(state: EditorState): Array<{ from: number; to: number }> | null {
	const info = chunkInfo(state);
	if (!info) return null;
	const side = info.side === 'b' ? 'b' : 'a';
	return info.chunks.map((chunk) => (side === 'b' ? { from: chunk.fromB, to: chunk.toB } : { from: chunk.fromA, to: chunk.toA }));
}

function inChange(pos: number, ranges: ReadonlyArray<{ from: number; to: number }>): boolean {
	for (const range of ranges) {
		if (pos >= range.from && pos < range.to) return true;
	}
	return false;
}

function whitespaceSignature(state: EditorState): string {
	const mode = state.facet(showAllWhitespace) ? 'all' : 'changes';
	const info = chunkInfo(state);
	if (!info) return mode;
	const body = info.chunks.map((chunk) => `${chunk.fromA},${chunk.toA},${chunk.fromB},${chunk.toB}`).join(';');
	return `${mode}:${info.side}:${body}`;
}

/** Visual marks only. Spaces, tabs, and line breaks in the document are unchanged. */
function buildWhitespace(view: EditorView): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const doc = view.state.doc;
	const showAll = view.state.facet(showAllWhitespace);
	const changes = showAll ? null : changedRanges(view.state);
	if (!showAll && !changes) return Decoration.none;
	for (const range of view.visibleRanges) {
		let pos = range.from;
		while (pos <= range.to && pos <= doc.length) {
			const line = doc.lineAt(Math.min(pos, doc.length));
			const from = Math.max(line.from, range.from);
			const to = Math.min(line.to, range.to);
			const text = doc.sliceString(from, to);
			for (let i = 0; i < text.length; i++) {
				const ch = text[i];
				if (ch !== ' ' && ch !== '\t') continue;
				const at = from + i;
				if (!showAll && changes && !inChange(at, changes)) continue;
				builder.add(at, at + 1, ch === '\t' ? tabMark : spaceMark);
			}
			const breakAt = line.to;
			const showBreak = line.to < doc.length && breakAt >= range.from && breakAt <= range.to && (showAll || (changes ? inChange(breakAt, changes) : false));
			if (showBreak) builder.add(breakAt, breakAt, endOfLine);
			if (line.to >= range.to) break;
			pos = line.to + 1;
		}
	}
	return builder.finish();
}

const whitespacePlugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		private signature: string;
		constructor(view: EditorView) {
			this.signature = whitespaceSignature(view.state);
			this.decorations = buildWhitespace(view);
		}
		update(update: ViewUpdate) {
			const signature = whitespaceSignature(update.state);
			if (update.docChanged || update.viewportChanged || signature !== this.signature) {
				this.signature = signature;
				this.decorations = buildWhitespace(update.view);
			}
		}
	},
	{ decorations: (plugin) => plugin.decorations },
);

export function whitespaceExtensions(showAll: boolean): Extension {
	return [showAllWhitespace.of(showAll), whitespacePlugin];
}
