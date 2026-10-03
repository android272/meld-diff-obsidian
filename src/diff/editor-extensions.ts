import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentUnit } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state';
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder } from '@codemirror/view';
import { isMarkdownPath } from '../text-util';
import { chunkDecorationExtensions } from './decorations';
import { whitespaceExtensions } from './whitespace';

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
	lineNumbers: Compartment;
	whitespace: Compartment;
	activeLine: Compartment;
	editable: Compartment;
	hint: Compartment;
	dark: Compartment;
}

export function createCompartments(): PaneCompartments {
	return {
		wrap: new Compartment(),
		lineNumbers: new Compartment(),
		whitespace: new Compartment(),
		activeLine: new Compartment(),
		editable: new Compartment(),
		hint: new Compartment(),
		dark: new Compartment(),
	};
}

export function emptyHintExtension(hint: string | null): Extension {
	return hint ? placeholder(hint) : [];
}

export function editorChromeEffects(slots: PaneCompartments, readOnly: boolean, emptyHint: string | null) {
	return [
		slots.editable.reconfigure(EditorView.editable.of(!readOnly)),
		slots.hint.reconfigure(emptyHintExtension(emptyHint)),
	];
}

export function lineNumberExtensions(on: boolean): Extension {
	return on ? lineNumbers() : [];
}

export function activeLineExtensions(showCurrent: boolean, showNumbers: boolean): Extension {
	if (!showCurrent) return [];
	return showNumbers ? [highlightActiveLine(), highlightActiveLineGutter()] : highlightActiveLine();
}

/** Editor chrome both layouts reconfigure. Highlight and collapse stay with the host that owns them. */
export function paneChromeEffects(
	slots: PaneCompartments,
	options: {
		wrap: boolean;
		showLineNumbers: boolean;
		showWhitespace: boolean;
		showCurrentLine: boolean;
		dark: boolean;
	},
	partial: {
		wrap?: boolean;
		showLineNumbers?: boolean;
		showWhitespace?: boolean;
		showCurrentLine?: boolean;
		dark?: boolean;
	},
) {
	const effects: Array<ReturnType<Compartment['reconfigure']>> = [];
	if (partial.wrap !== undefined) effects.push(slots.wrap.reconfigure(options.wrap ? EditorView.lineWrapping : []));
	if (partial.showLineNumbers !== undefined) effects.push(slots.lineNumbers.reconfigure(lineNumberExtensions(options.showLineNumbers)));
	if (partial.showWhitespace !== undefined) effects.push(slots.whitespace.reconfigure(whitespaceExtensions(options.showWhitespace)));
	if (partial.showCurrentLine !== undefined || partial.showLineNumbers !== undefined) {
		effects.push(slots.activeLine.reconfigure(activeLineExtensions(options.showCurrentLine, options.showLineNumbers)));
	}
	if (partial.dark !== undefined) effects.push(slots.dark.reconfigure(EditorView.darkTheme.of(options.dark)));
	return effects;
}

export function paneExtensions(options: {
	path: string | null;
	wrap: boolean;
	showCurrentLine: boolean;
	showLineNumbers: boolean;
	showWhitespace: boolean;
	readOnly: boolean;
	emptyHint: string | null;
	dark: boolean;
	tabSize: number;
	useTab: boolean;
	keys: PaneKeymap;
	compartments: PaneCompartments;
	extra?: Extension[];
	/**
	 * Line classes from the merge chunk field. Stacked editors are not a MergeView,
	 * so the plugin would rebuild empty decorations on every edit.
	 */
	lineHunks?: boolean;
}): Extension[] {
	const { compartments: slots, keys } = options;
	const extensions = [
		slots.lineNumbers.of(lineNumberExtensions(options.showLineNumbers)),
		slots.whitespace.of(whitespaceExtensions(options.showWhitespace)),
		slots.activeLine.of(activeLineExtensions(options.showCurrentLine, options.showLineNumbers)),
		drawSelection(),
		history(),
		bracketMatching(),
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
		slots.hint.of(emptyHintExtension(options.emptyHint)),
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
				color: 'var(--text-muted)',
				border: 'none',
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
	];
	if (options.lineHunks !== false) extensions.push(chunkDecorationExtensions());
	if (isMarkdownPath(options.path)) {
		extensions.push(markdown({ addKeymap: false, completeHTMLTags: false, pasteURLAsLink: false }));
	}
	if (options.extra) extensions.push(...options.extra);
	return extensions;
}
