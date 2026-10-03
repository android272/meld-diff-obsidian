import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultSurfaceOptions, surfaceCanReuse } from '../src/diff/surface-shared';

const kinds = { left: true, right: false };
const left = { path: 'notes/a.md', placeholder: null };
const right = { path: 'notes/b.txt', placeholder: null };

test('open editors are reused only when the language and scan limit match', () => {
	assert.equal(surfaceCanReuse(true, kinds, left, right, 10000, 10000), true);
	assert.equal(surfaceCanReuse(false, kinds, left, right, 10000, 10000), false);
	assert.equal(surfaceCanReuse(true, null, left, right, 10000, 10000), false);
	assert.equal(surfaceCanReuse(true, kinds, { ...left, placeholder: 'Too big' }, right, 10000, 10000), false);
	assert.equal(surfaceCanReuse(true, kinds, left, right, 500, 10000), false);
	assert.equal(surfaceCanReuse(true, kinds, { path: 'notes/a.txt', placeholder: null }, right, 10000, 10000), false);
	assert.equal(surfaceCanReuse(true, { left: false, right: false }, { path: null, placeholder: null }, { path: null, placeholder: null }, 10000, 10000), true);
});

test('both layouts start from the same editor options', () => {
	assert.deepEqual(defaultSurfaceOptions(), {
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
	});
});
