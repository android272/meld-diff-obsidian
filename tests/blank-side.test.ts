import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Chunk } from '@codemirror/merge';
import { Text } from '@codemirror/state';
import {
	EMPTY_EDITOR_HINT,
	NO_CHANGES,
	NO_FILE_YET,
	diffTabTitle,
	editorFace,
	saveAsFileName,
	saveDisabledReason,
	saveEnabled,
	sideBadgeDirty,
	sideHasFile,
	sideIsDirty,
	sidesToLoad,
	type SideBuffer,
} from '../src/diff/blank-side';

function buffer(partial: Partial<SideBuffer> = {}): SideBuffer {
	return {
		path: null,
		text: '',
		saved: '',
		binary: false,
		tooBig: false,
		deleted: false,
		...partial,
	};
}

test('a new diff is titled Diff and both sides are empty editable editors', () => {
	assert.equal(diffTabTitle(null, null), 'Diff');
	const face = editorFace(buffer(), '');
	assert.equal(face.readOnly, false);
	assert.equal(face.placeholder, null);
	assert.equal(face.text, '');
	assert.equal(face.emptyHint, EMPTY_EDITOR_HINT);
	assert.equal(sideHasFile(buffer()), false);
	assert.equal(sideIsDirty(buffer()), false);
});

test('typed text on a blank side is kept and diffs against the other side', () => {
	const left = editorFace(buffer({ text: 'alpha' }), '');
	const right = editorFace(buffer({ text: 'beta' }), '');
	assert.equal(left.text, 'alpha');
	assert.equal(right.text, 'beta');
	assert.equal(left.readOnly, false);
	assert.equal(sideIsDirty(buffer({ text: 'alpha' })), true);
	const chunks = Chunk.build(Text.of(['alpha']), Text.of(['beta']));
	assert.ok(chunks.length > 0);
	assert.equal(Chunk.build(Text.of(['']), Text.of([''])).length, 0);
});

test('a picked file replaces that side and a loaded file has no empty hint', () => {
	const face = editorFace(buffer({ path: 'Notes/a.md', text: 'hello', saved: 'hello' }), 'a.md · 5 B');
	assert.equal(face.text, 'hello');
	assert.equal(face.readOnly, false);
	assert.equal(face.emptyHint, null);
	assert.equal(face.placeholder, null);
	assert.equal(sideHasFile(buffer({ path: 'Notes/a.md' })), true);
	assert.equal(sideIsDirty(buffer({ path: 'Notes/a.md', text: 'hello', saved: 'hello' })), false);
	assert.equal(diffTabTitle('Notes/a.md', null), 'a.md ↔ Empty');
});

test('binary and deleted files stay non-editors or read-only', () => {
	const binary = editorFace(buffer({ path: 'a.png', binary: true }), 'a.png · 4 B');
	assert.equal(binary.placeholder, 'Cannot text-diff this file.');
	assert.equal(binary.readOnly, true);
	assert.equal(binary.text, '');
	assert.equal(sideIsDirty(buffer({ path: 'a.png', binary: true, text: 'x', saved: '' })), false);
	const deleted = editorFace(buffer({ path: 'a.md', deleted: true, text: 'x', saved: 'x' }), 'a.md · 1 B');
	assert.equal(deleted.readOnly, true);
	assert.equal(deleted.placeholder, null);
});

test('an empty unbound side is not unsaved and typed text is not a linked edit', () => {
	const empty = buffer();
	const typed = buffer({ text: 'alpha' });
	assert.equal(sideIsDirty(empty), false);
	assert.equal(sideBadgeDirty(empty), false);
	assert.equal(sideBadgeDirty(typed), false);
	assert.equal(saveEnabled(typed), false);
	assert.equal(saveDisabledReason(typed), NO_FILE_YET);
});

test('a linked dirty side can be saved and a clean side cannot', () => {
	const dirty = buffer({ path: 'Notes/a.md', text: 'new', saved: 'old' });
	const clean = buffer({ path: 'Notes/a.md', text: 'old', saved: 'old' });
	assert.equal(sideIsDirty(dirty), true);
	assert.equal(sideBadgeDirty(dirty), true);
	assert.equal(saveEnabled(dirty), true);
	assert.equal(sideBadgeDirty(clean), false);
	assert.equal(saveEnabled(clean), false);
	assert.equal(saveDisabledReason(clean), NO_CHANGES);
	assert.equal(saveEnabled(buffer({ path: 'a.md', text: 'x', saved: 'x', deleted: true })), true);
});

test('save as turns a name into a note and rejects a path', () => {
	assert.equal(saveAsFileName('Note'), 'Note.md');
	assert.equal(saveAsFileName('Note.md'), 'Note.md');
	assert.equal(saveAsFileName('  '), null);
	assert.equal(saveAsFileName('folder/note'), null);
	assert.equal(saveAsFileName('.md'), null);
});

test('picking a file reloads only that side once the comparison is open', () => {
	assert.deepEqual(sidesToLoad(false, null, null, null, null), { left: true, right: true });
	assert.deepEqual(sidesToLoad(false, 'a.md', 'b.md', 'a.md', 'b.md'), { left: true, right: true });
	assert.deepEqual(sidesToLoad(true, null, null, 'a.md', null), { left: true, right: false });
	assert.deepEqual(sidesToLoad(true, 'a.md', null, 'a.md', 'b.md'), { left: false, right: true });
	assert.deepEqual(sidesToLoad(true, 'a.md', 'b.md', 'a.md', 'b.md'), { left: false, right: false });
});
