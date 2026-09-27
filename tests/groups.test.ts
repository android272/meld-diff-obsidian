import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildConflictGroups } from '../src/index/group-conflicts';
import { DEFAULT_IGNORE_GLOBS, syncthingPreset } from '../src/settings';

const patterns = [syncthingPreset()];

test('groups several conflicts under the original and sorts them by time', () => {
	const groups = buildConflictGroups([
		{ path: 'Notes/foo.md', mtime: 1, size: 10 },
		{ path: 'Notes/foo.sync-conflict-20241201-091200-ZZZZZZ2.md', mtime: 3, size: 12 },
		{ path: 'Notes/foo.sync-conflict-20241128-143022-ABCDEF1.md', mtime: 2, size: 11 },
		{ path: 'Notes/bar.md', mtime: 1, size: 4 },
	], patterns, DEFAULT_IGNORE_GLOBS);
	assert.equal(groups.length, 1);
	const group = groups[0];
	assert.ok(group);
	assert.equal(group.originalPath, 'Notes/foo.md');
	assert.equal(group.originalExists, true);
	assert.deepEqual(group.conflicts.map((conflict) => conflict.modifiedBy), ['ABCDEF1', 'ZZZZZZ2']);
});

test('a missing original is still listed', () => {
	const groups = buildConflictGroups([
		{ path: 'foo.sync-conflict-20240101-120000-ABCDEF1.md', mtime: 1, size: 8 },
	], patterns, DEFAULT_IGNORE_GLOBS);
	assert.equal(groups[0]?.originalPath, 'foo.md');
	assert.equal(groups[0]?.originalExists, false);
});

test('ignored folders are not indexed', () => {
	const groups = buildConflictGroups([
		{ path: '.obsidian/foo.sync-conflict-20240101-120000-ABCDEF1.md', mtime: 1, size: 8 },
		{ path: 'notes/.git/foo.sync-conflict-20240101-120000-ABCDEF1.md', mtime: 1, size: 8 },
	], patterns, DEFAULT_IGNORE_GLOBS);
	assert.equal(groups.length, 0);
});

test('an invalid pattern does not hide a later valid one', () => {
	const groups = buildConflictGroups([
		{ path: 'foo.sync-conflict-20240101-120000-ABCDEF1.md', mtime: 1, size: 8 },
	], [{ ...syncthingPreset(), id: 'bad', expression: '(' }, syncthingPreset()], []);
	assert.equal(groups.length, 1);
	assert.equal(groups[0]?.conflicts[0]?.patternId, 'preset-syncthing');
});
