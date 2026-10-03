import { fileName } from '../text-util';

/** Muted text in an empty editable editor that has no file yet. */
export const EMPTY_EDITOR_HINT = 'Select a file or type';

/** File button label when the side has no note. */
export const NO_FILE_LABEL = 'No file';

/** Save tooltip and menu caption when the side has no note. */
export const NO_FILE_YET = 'No file yet';

/** Save tooltip and menu caption when the linked note matches the buffer. */
export const NO_CHANGES = 'No changes.';

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

/**
 * Unsaved work. A linked side differs from disk, or an unbound side has text.
 * An empty unbound side matches its empty saved buffer, so it is not unsaved.
 * Binary and oversized panes are not editable, so they are never unsaved.
 */
export function sideIsDirty(state: Pick<SideBuffer, 'text' | 'saved' | 'binary' | 'tooBig'>): boolean {
	if (state.binary || state.tooBig) return false;
	return state.text !== state.saved;
}

/** Dot on the A or B badge. Only a linked note with unsaved edits. */
export function sideBadgeDirty(state: Pick<SideBuffer, 'path' | 'text' | 'saved' | 'binary' | 'tooBig'>): boolean {
	return state.path !== null && sideIsDirty(state);
}

/**
 * Save writes the linked note. It stays disabled with no note, and when the
 * buffer already matches disk. A missing or deleted note can still be written.
 */
export function saveEnabled(state: SideBuffer & { missing?: boolean }): boolean {
	if (!state.path || state.binary || state.tooBig) return false;
	if (state.deleted || state.missing) return true;
	return state.text !== state.saved;
}

export function saveDisabledReason(state: SideBuffer & { missing?: boolean }): string {
	if (!state.path) return NO_FILE_YET;
	if (state.binary || state.tooBig) return 'This side is not a text file.';
	if (!saveEnabled(state)) return NO_CHANGES;
	return '';
}

/**
 * Save as stores a note name. A name with no extension becomes a markdown note.
 * A path is rejected because the folder is chosen separately.
 */
export function saveAsFileName(name: string): string | null {
	const trimmed = name.trim();
	if (!trimmed || /[\\/\0]/.test(trimmed) || trimmed === '.' || trimmed === '..') return null;
	const file = trimmed.includes('.') ? trimmed : `${trimmed}.md`;
	if (file === '.md') return null;
	return file;
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
