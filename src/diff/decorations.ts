import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { getChunks } from '@codemirror/merge';
import { chunkKind } from './hunk-text';

function buildDecorations(view: EditorView): DecorationSet {
	const info = getChunks(view.state);
	if (!info) return Decoration.none;
	const builder = new RangeSetBuilder<Decoration>();
	const doc = view.state.doc;
	for (let index = 0; index < info.chunks.length; index++) {
		const chunk = info.chunks[index];
		if (!chunk) continue;
		const from = info.side === 'b' ? chunk.fromB : chunk.fromA;
		const to = info.side === 'b' ? chunk.toB : chunk.toA;
		if (from === to || from > doc.length) continue;
		const deco = Decoration.line({ class: `meld-hunk-${chunkKind(chunk)}` });
		const limit = Math.min(Math.max(from, to), doc.length);
		let pos = Math.max(0, Math.min(from, doc.length));
		while (pos < limit) {
			const line = doc.lineAt(pos);
			builder.add(line.from, line.from, deco);
			const next = line.to + 1;
			if (next <= pos) break;
			pos = next;
		}
	}
	return builder.finish();
}

const chunkDecorations = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		constructor(view: EditorView) {
			this.decorations = buildDecorations(view);
		}
		update(update: ViewUpdate) {
			const effects = update.transactions.some((transaction) => transaction.effects.length > 0);
			if (update.docChanged || update.viewportChanged || effects) {
				try {
					this.decorations = buildDecorations(update.view);
				} catch (error) {
					console.error('Meld Diff: hunk decorations failed', error);
					this.decorations = Decoration.none;
				}
			}
		}
	},
	{ decorations: (plugin) => plugin.decorations },
);

export function chunkDecorationExtensions() {
	return [chunkDecorations];
}
