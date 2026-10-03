import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileBarLabel } from '../src/text-util';

test('a nested file shows the immediate parent and the stem', () => {
	assert.deepEqual(fileBarLabel('a/b/foo/bar.md'), { keep: 'foo/bar', tail: '.md' });
});

test('a root file keeps the filename and has no parent', () => {
	assert.deepEqual(fileBarLabel('foo.md'), { keep: 'foo', tail: '.md' });
});

test('the sync-conflict suffix is the truncatable end', () => {
	assert.deepEqual(fileBarLabel('notes/foo.sync-conflict-20241128-143022-ABCDEF1.md'), {
		keep: 'notes/foo',
		tail: '.sync-conflict-20241128-143022-ABCDEF1.md',
	});
});

test('a sync-conflict suffix without a device id is still the tail', () => {
	assert.deepEqual(fileBarLabel('foo.sync-conflict-20241128-143022.md'), {
		keep: 'foo',
		tail: '.sync-conflict-20241128-143022.md',
	});
});

test('an extension before the sync-conflict marker stays in the stem', () => {
	assert.deepEqual(fileBarLabel('dir/foo.md.sync-conflict-20241128-143022-ABCDEF1.md'), {
		keep: 'dir/foo.md',
		tail: '.sync-conflict-20241128-143022-ABCDEF1.md',
	});
});

test('a name with no extension has nothing to truncate', () => {
	assert.deepEqual(fileBarLabel('notes/README'), { keep: 'notes/README', tail: '' });
});

test('a dotfile stem is kept whole', () => {
	assert.deepEqual(fileBarLabel('.gitignore'), { keep: '.gitignore', tail: '' });
});
