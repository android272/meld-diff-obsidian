import { fileName } from '../text-util';

/** Muted text in an empty editable editor that has no file yet. */
export const EMPTY_EDITOR_HINT = 'Select a file or type';

/** Shown when Save cannot run because that side has no file. */
export const SAVE_NEEDS_FILE = 'Pick a file to save this side.';

export interface SideBuffer {
	path: string | null;
	text: string;
	saved: string;
	binary: boolean;
	tooBig: boolean;
	deleted: boolean;
}

export interface EditorFace {
	text: string;
	readOnly: boolean;
	/** Static panel. Binary and oversized files. An empty comparison is not a panel. */
	placeholder: string | null;
	detail: string;
	/** Muted hint inside an empty editable editor. */
	emptyHint: string | null;
}

export function sideHasFile(state: { path: string | null }): boolean {
	return state.path !== null;
}

/** Typed text with no file is dirty. Binary and oversized panes are not. */
export function sideIsDirty(state: Pick<SideBuffer, 'text' | 'saved' | 'binary' | 'tooBig'>): boolean {
	if (state.binary || state.tooBig) return false;
	return state.text !== state.saved;
}

/**
 * A side with no path is an empty editable buffer. The hint is hidden once
 * the user types, and the text is what the live diff compares.
 */
export function editorFace(state: SideBuffer, fileLabel: string): EditorFace {
	if (!state.path) {
		return {
			text: state.text,
			readOnly: false,
			placeholder: null,
			detail: '',
			emptyHint: EMPTY_EDITOR_HINT,
		};
	}
	if (state.binary) {
		return {
			text: '',
			readOnly: true,
			placeholder: 'Cannot text-diff this file.',
			detail: fileLabel,
			emptyHint: null,
		};
	}
	if (state.tooBig) {
		return {
			text: '',
			readOnly: true,
			placeholder: 'This file is too large to text-diff.',
			detail: fileLabel,
			emptyHint: null,
		};
	}
	return {
		text: state.text,
		readOnly: state.deleted,
		placeholder: null,
		detail: '',
		emptyHint: null,
	};
}

export function diffTabTitle(left: string | null, right: string | null): string {
	const a = fileName(left);
	const b = fileName(right);
	if (!a && !b) return 'Diff';
	return `${a || 'Empty'} ↔ ${b || 'Empty'}`;
}

/**
 * The first load reads both sides. After that, only a side whose path
 * changed is read, so picking a file replaces that side and leaves the
 * other buffer alone.
 */
export function sidesToLoad(
	loaded: boolean,
	currentLeft: string | null,
	currentRight: string | null,
	nextLeft: string | null,
	nextRight: string | null,
): { left: boolean; right: boolean } {
	if (!loaded) return { left: true, right: true };
	return {
		left: nextLeft !== currentLeft,
		right: nextRight !== currentRight,
	};
}
