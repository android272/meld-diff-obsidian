import assert from 'node:assert/strict';
import { test } from 'node:test';
import { explainPattern, globToRegExp, matchConflictPath, pathIgnored, compileIgnore, stripSyncConflict } from '../src/patterns';
import { NEXTCLOUD_GLOB, obsidianSyncPreset, syncthingPreset } from '../src/settings';

const syncthing = syncthingPreset();
const obsidian = { ...obsidianSyncPreset(), enabled: true };

test('syncthing conflict recovers the original note', () => {
	const path = 'Notes/foo.sync-conflict-20241128-143022-ABCDEF1.md';
	const match = matchConflictPath(path, [syncthing], (candidate) => candidate === 'Notes/foo.md');
	assert.ok(match);
	assert.equal(match.originalPath, 'Notes/foo.md');
	assert.equal(match.originalExists, true);
	assert.equal(match.groups.date, '20241128');
	assert.equal(match.groups.time, '143022');
	assert.equal(match.groups.modifiedBy, 'ABCDEF1');
});

test('syncthing conflict in the vault root', () => {
	const match = matchConflictPath('foo.sync-conflict-20241128-143022-ABCDEF1.md', [syncthing]);
	assert.equal(match?.originalPath, 'foo.md');
	assert.equal(match?.originalExists, false);
});

test('dotted stem prefers the original that exists', () => {
	const path = 'Notes/foo.md.sync-conflict-20240101-120000-ABCDEF1.md';
	const match = matchConflictPath(path, [syncthing], (candidate) => candidate === 'Notes/foo.md');
	assert.equal(match?.originalPath, 'Notes/foo.md');
	assert.equal(match?.originalExists, true);
});

test('dotted stem falls back to the first candidate when nothing exists', () => {
	const path = 'Notes/foo.md.sync-conflict-20240101-120000-ABCDEF1.md';
	const match = matchConflictPath(path, [syncthing]);
	assert.equal(match?.originalPath, 'Notes/foo.md.md');
	assert.equal(match?.originalExists, false);
});

test('a normal note is not a conflict', () => {
	assert.equal(matchConflictPath('Notes/foo.md', [syncthing]), null);
});

test('obsidian sync pattern does not require a device id', () => {
	const match = matchConflictPath('foo.sync-conflict-20241128-143022.md', [syncthing, obsidian]);
	assert.equal(match?.patternId, obsidian.id);
	assert.equal(match?.originalPath, 'foo.md');
	assert.equal(match?.groups.modifiedBy, undefined);
});

test('disabled patterns are skipped and the first enabled match wins', () => {
	const second = { ...syncthing, id: 'second', name: 'Second' };
	const first = { ...syncthing, id: 'first', enabled: false };
	const match = matchConflictPath('foo.sync-conflict-20241128-143022-ABCDEF1.md', [first, second]);
	assert.equal(match?.patternId, 'second');
});

test('invalid regex is reported and does not throw', () => {
	const explained = explainPattern({ ...syncthing, expression: '(' }, 'foo.md', () => false);
	assert.equal(explained.matched, false);
	assert.ok(explained.error);
	assert.equal(matchConflictPath('foo.md', [{ ...syncthing, expression: '(' }, syncthing]), null);
});

test('nextcloud glob recovers the original name', () => {
	const pattern = {
		id: 'next',
		enabled: true,
		name: 'Nextcloud',
		mode: 'glob' as const,
		expression: NEXTCLOUD_GLOB,
		originalMode: 'replace' as const,
	};
	const path = 'Notes/foo (conflicted copy 2024-11-28 120000).md';
	const match = matchConflictPath(path, [pattern], (candidate) => candidate === 'Notes/foo.md');
	assert.equal(match?.originalPath, 'Notes/foo.md');
	assert.equal(matchConflictPath('Notes/foo.md', [pattern]), null);
});

test('ignore globs skip obsidian and git internals', () => {
	const regs = compileIgnore(['.obsidian/**', '.trash/**', '**/.git/**', '**/.stfolder/**', '**/.stversions/**']);
	assert.equal(pathIgnored('.obsidian/plugins/meld-diff/main.js', regs), true);
	assert.equal(pathIgnored('.git/config', regs), true);
	assert.equal(pathIgnored('sub/.git/HEAD', regs), true);
	assert.equal(pathIgnored('.stversions/foo.md', regs), true);
	assert.equal(pathIgnored('Notes/foo.md', regs), false);
});

test('strip sync marker keeps the extension', () => {
	assert.equal(stripSyncConflict('Notes/foo.sync-conflict-20240101-120000-ABCDEF1.md'), 'Notes/foo.md');
});

test('glob stars do not cross directories unless doubled', () => {
	assert.equal(globToRegExp('Notes/*.md').test('Notes/foo.md'), true);
	assert.equal(globToRegExp('Notes/*.md').test('Notes/sub/foo.md'), false);
	assert.equal(globToRegExp('**/*.md').test('Notes/sub/foo.md'), true);
});
