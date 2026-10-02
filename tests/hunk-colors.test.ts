import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	adoptHunkColorDeclarations,
	cssColorToHex,
	hunkColorStyleText,
	meldColorDeclarations,
	sameDeclarations,
} from '../src/diff/hunk-colors';
import { DEFAULT_SETTINGS, mergeSettings } from '../src/settings';
import type { MeldDiffSettings } from '../src/types';

test('missing color settings follow the theme', () => {
	const settings = mergeSettings({});
	assert.equal(settings.colorSource, 'theme');
	assert.equal(settings.hunkDelete, '');
	assert.equal(settings.hunkOpacity, 0.2);
	assert.equal(settings.tokenOpacity, 0.35);
	const css = hunkColorStyleText(settings);
	assert.match(css, /--meld-hunk-delete: var\(--color-red, var\(--text-error\)\);/);
	assert.match(css, /--meld-hunk-insert: var\(--color-green, var\(--text-success\)\);/);
	assert.match(css, /--meld-hunk-change: var\(--color-yellow, var\(--text-warning\)\);/);
	assert.match(css, /--meld-hunk-token: var\(--color-orange, var\(--text-warning\)\);/);
	assert.match(css, /--meld-hunk-block-opacity: 0\.2;/);
	assert.match(css, /--meld-hunk-token-opacity: 0\.35;/);
});

test('custom colors keep a valid hex and drop anything else', () => {
	const settings = mergeSettings({
		colorSource: 'custom',
		hunkDelete: '#abc',
		hunkInsert: 'red',
		hunkChange: '#e0de71',
		hunkToken: '#e9973fff',
		hunkOpacity: 0.333,
		tokenOpacity: 2,
	});
	assert.equal(settings.colorSource, 'custom');
	assert.equal(settings.hunkDelete, '#abc');
	assert.equal(settings.hunkInsert, '');
	assert.equal(settings.hunkChange, '#e0de71');
	assert.equal(settings.hunkToken, '#e9973fff');
	assert.equal(settings.hunkOpacity, 0.33);
	assert.equal(settings.tokenOpacity, 0.6);
	const css = hunkColorStyleText(settings);
	assert.match(css, /--meld-hunk-delete: #abc;/);
	assert.match(css, /--meld-hunk-insert: var\(--color-green, var\(--text-success\)\);/);
	assert.match(css, /--meld-hunk-change: #e0de71;/);
	assert.match(css, /--meld-hunk-token: #e9973fff;/);
});

test('rgb theme colors become hex swatches', () => {
	assert.equal(cssColorToHex('rgb(251, 70, 76)'), '#fb464c');
	assert.equal(cssColorToHex('rgba(68 207 110 / 0.4)'), '#44cf6e');
	assert.equal(cssColorToHex('not a color'), null);
});

test('a Style Settings edit updates only the variable that changed', () => {
	const settings: MeldDiffSettings = {
		...DEFAULT_SETTINGS,
		patterns: [],
		colorSource: 'theme',
		hunkDelete: '',
		hunkInsert: '#44cf6e',
		hunkChange: '',
		hunkToken: '',
	};
	const previous = meldColorDeclarations('body { --meld-hunk-insert: #44cf6e; --meld-hunk-block-opacity: 0.2; }');
	const next = meldColorDeclarations('body { --meld-hunk-delete: #112233; --meld-hunk-insert: #44cf6e; --meld-hunk-block-opacity: 0.28; }');
	assert.equal(sameDeclarations(previous, next), false);
	assert.equal(adoptHunkColorDeclarations(settings, previous, next), true);
	assert.equal(settings.colorSource, 'custom');
	assert.equal(settings.hunkDelete, '#112233');
	assert.equal(settings.hunkInsert, '#44cf6e');
	assert.equal(settings.hunkChange, '');
	assert.equal(settings.hunkOpacity, 0.28);
	assert.equal(settings.tokenOpacity, DEFAULT_SETTINGS.tokenOpacity);
});

test('an opacity edit leaves theme colors in charge', () => {
	const settings: MeldDiffSettings = {
		...DEFAULT_SETTINGS,
		patterns: [],
		colorSource: 'theme',
		hunkInsert: '#44cf6e',
	};
	const previous = meldColorDeclarations('body { --meld-hunk-block-opacity: 0.2; }');
	const next = meldColorDeclarations('body { --meld-hunk-block-opacity: 0.3; }');
	assert.equal(adoptHunkColorDeclarations(settings, previous, next), true);
	assert.equal(settings.colorSource, 'theme');
	assert.equal(settings.hunkInsert, '#44cf6e');
	assert.equal(settings.hunkOpacity, 0.3);
	assert.match(hunkColorStyleText(settings), /--meld-hunk-insert: var\(--color-green/);
});

test('clearing every Style Settings color returns to the theme', () => {
	const settings: MeldDiffSettings = {
		...DEFAULT_SETTINGS,
		patterns: [],
		colorSource: 'custom',
		hunkDelete: '#112233',
		hunkOpacity: 0.4,
	};
	const previous = meldColorDeclarations('body { --meld-hunk-delete: #112233; --meld-hunk-block-opacity: 0.4; }');
	const next = meldColorDeclarations('body { --other: 1; }');
	assert.equal(adoptHunkColorDeclarations(settings, previous, next), true);
	assert.equal(settings.colorSource, 'theme');
	assert.equal(settings.hunkDelete, '');
	assert.equal(settings.hunkOpacity, 0.2);
});
