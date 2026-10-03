import { EditorView } from '@codemirror/view';
import { isMarkdownPath } from '../text-util';
import { editorChromeEffects, type PaneCompartments } from './editor-extensions';

/** Starting editor options for both layouts. A host replaces this from settings on show. */
export function defaultSurfaceOptions() {
	return {
		wrap: true,
		showCurrentLine: true,
		showLineNumbers: true,
		showWhitespace: false,
		highlight: true,
		collapse: false,
		collapseMargin: 3,
		scanLimit: 10000,
		dark: false,
		tabSize: 4,
		useTab: true,
		aligned: true,
	};
}

/** Reuse the open editors when the language and diff scan limit are unchanged. */
export function surfaceCanReuse(
	ready: boolean,
	kinds: { left: boolean; right: boolean } | null,
	left: { path: string | null; placeholder: string | null },
	right: { path: string | null; placeholder: string | null },
	scanLimit: number,
	previousScanLimit: number,
): boolean {
	if (!ready || !kinds) return false;
	if (left.placeholder || right.placeholder) return false;
	if (scanLimit !== previousScanLimit) return false;
	return kinds.left === isMarkdownPath(left.path) && kinds.right === isMarkdownPath(right.path);
}

export function fillPlaceholder(host: HTMLElement, title: string, detail: string): void {
	const box = host.createDiv({ cls: 'meld-pane-placeholder' });
	box.createDiv({ cls: 'meld-placeholder-title', text: title });
	if (detail) box.createDiv({ cls: 'meld-placeholder-detail', text: detail });
}

/**
 * Write a side's text into an editor that is already open.
 * `guard` runs only when the text changes, so a host can ignore the selection event that load produces.
 */
export function replacePaneDocument(
	view: EditorView,
	slots: PaneCompartments,
	pane: { text: string; readOnly: boolean; emptyHint: string | null },
	guard?: (dispatch: () => void) => void,
): void {
	const effects = editorChromeEffects(slots, pane.readOnly, pane.emptyHint);
	if (view.state.doc.toString() === pane.text) {
		view.dispatch({ effects });
		return;
	}
	const dispatch = () => view.dispatch({
		changes: { from: 0, to: view.state.doc.length, insert: pane.text },
		effects,
		userEvent: 'meld.load',
	});
	if (guard) guard(dispatch);
	else dispatch();
}
