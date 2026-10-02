import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Chunk } from '@codemirror/merge';
import { Text } from '@codemirror/state';
import {
	EMPTY_EDITOR_HINT,
	diffTabTitle,
	editorFace,
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

test('picking a file reloads only that side once the comparison is open', () => {
	assert.deepEqual(sidesToLoad(false, null, null, null, null), { left: true, right: true });
	assert.deepEqual(sidesToLoad(false, 'a.md', 'b.md', 'a.md', 'b.md'), { left: true, right: true });
	assert.deepEqual(sidesToLoad(true, null, null, 'a.md', null), { left: true, right: false });
	assert.deepEqual(sidesToLoad(true, 'a.md', null, 'a.md', 'b.md'), { left: false, right: true });
	assert.deepEqual(sidesToLoad(true, 'a.md', 'b.md', 'a.md', 'b.md'), { left: false, right: false });
});
