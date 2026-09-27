import { RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';

const spaceMark = Decoration.mark({ class: 'cm-ws-space' });
const tabMark = Decoration.mark({ class: 'cm-ws-tab' });

class EndOfLineWidget extends WidgetType {
	toDOM(): HTMLElement {
		const span = document.createElement('span');
		span.className = 'cm-ws-eol';
		span.textContent = '↵';
		span.setAttribute('aria-hidden', 'true');
		return span;
	}
	ignoreEvent(): boolean {
		return true;
	}
}

const endOfLine = Decoration.widget({ widget: new EndOfLineWidget(), side: -1 });

/** Visual marks only. Spaces, tabs, and line breaks in the document are unchanged. */
function buildWhitespace(view: EditorView): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const doc = view.state.doc;
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
				builder.add(from + i, from + i + 1, ch === '\t' ? tabMark : spaceMark);
			}
			if (line.to < doc.length && line.to >= range.from && line.to <= range.to) builder.add(line.to, line.to, endOfLine);
			if (line.to >= range.to) break;
			pos = line.to + 1;
		}
	}
	return builder.finish();
}

const whitespacePlugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		constructor(view: EditorView) {
			this.decorations = buildWhitespace(view);
		}
		update(update: ViewUpdate) {
			if (update.docChanged || update.viewportChanged) this.decorations = buildWhitespace(update.view);
		}
	},
	{ decorations: (plugin) => plugin.decorations },
);

export function whitespaceExtensions(on: boolean): Extension {
	return on ? whitespacePlugin : [];
}
