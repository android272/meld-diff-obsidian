import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, defaultHighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state';
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import { isMarkdownPath } from '../text-util';
import { chunkDecorationExtensions } from './decorations';

export interface PaneKeymap {
	onSave: () => boolean;
	onSaveBoth: () => boolean;
	onNext: (view: EditorView) => boolean;
	onPrev: (view: EditorView) => boolean;
	onDoc: (text: string) => void;
	onFocus: () => void;
	onContextMenu: (event: MouseEvent, view: EditorView) => boolean;
}

export interface PaneCompartments {
	wrap: Compartment;
	activeLine: Compartment;
	editable: Compartment;
	dark: Compartment;
}

export function createCompartments(): PaneCompartments {
	return { wrap: new Compartment(), activeLine: new Compartment(), editable: new Compartment(), dark: new Compartment() };
}

export function activeLineExtensions(on: boolean): Extension {
	return on ? [highlightActiveLine(), highlightActiveLineGutter()] : [];
}

export function paneExtensions(options: {
	path: string | null;
	wrap: boolean;
	showCurrentLine: boolean;
	readOnly: boolean;
	dark: boolean;
	tabSize: number;
	useTab: boolean;
	keys: PaneKeymap;
	compartments: PaneCompartments;
}): Extension[] {
	const { compartments: slots, keys } = options;
	const extensions = [
		lineNumbers(),
		slots.activeLine.of(activeLineExtensions(options.showCurrentLine)),
		drawSelection(),
		history(),
		bracketMatching(),
		syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
		search({ top: true }),
		highlightSelectionMatches(),
		keymap.of([...searchKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
		Prec.high(keymap.of([
			{ key: 'Mod-s', run: () => keys.onSave() },
			{ key: 'Mod-Shift-s', run: () => keys.onSaveBoth() },
			{ key: 'Alt-ArrowDown', run: (view) => keys.onNext(view) },
			{ key: 'Alt-ArrowUp', run: (view) => keys.onPrev(view) },
		])),
		EditorState.tabSize.of(options.tabSize),
		indentUnit.of(options.useTab ? '\t' : ' '.repeat(Math.max(1, options.tabSize))),
		slots.wrap.of(options.wrap ? EditorView.lineWrapping : []),
		slots.editable.of(EditorView.editable.of(!options.readOnly)),
		slots.dark.of(EditorView.darkTheme.of(options.dark)),
		EditorView.contentAttributes.of({ spellcheck: 'true' }),
		EditorView.theme({
			'&': {
				backgroundColor: 'var(--background-primary)',
				color: 'var(--text-normal)',
			},
			'.cm-scroller': {
				fontFamily: 'var(--font-monospace-theme), var(--font-monospace), monospace',
				fontSize: 'var(--font-text-size)',
			},
			'.cm-gutters': {
				backgroundColor: 'var(--background-secondary)',
				color: 'var(--text-faint)',
				borderRight: '1px solid var(--background-modifier-border)',
			},
			'.cm-activeLine, .cm-activeLineGutter': {
				backgroundColor: 'var(--background-modifier-hover)',
			},
			'&.cm-focused': { outline: 'none' },
		}),
		EditorView.updateListener.of((update) => {
			if (update.docChanged) keys.onDoc(update.state.doc.toString());
			if (update.focusChanged && update.view.hasFocus) keys.onFocus();
		}),
		EditorView.domEventHandlers({
			contextmenu(event, view) {
				return keys.onContextMenu(event, view);
			},
		}),
		chunkDecorationExtensions(),
	];
	if (isMarkdownPath(options.path)) {
		extensions.push(markdown({ addKeymap: false, completeHTMLTags: false, pasteURLAsLink: false }));
	}
	return extensions;
}
