import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyEdit, chunkKind, deleteEdit, hunkHasBothSides, hunkText, replaceEdit } from '../src/diff/hunk-text';

test('replace into an empty side inserts the other hunk there', () => {
	const dest = 'alpha\ngamma\n';
	const src = 'alpha\nBETA\ngamma\n';
	assert.equal(applyEdit(dest, replaceEdit(src, 6, 11, dest, 6, 6)), 'alpha\nBETA\ngamma\n');
});

test('replace keeps a trailing newline so the next line stays intact', () => {
	const dest = 'alpha\nbeta\n';
	const src = 'alpha\nBETA\n';
	const edit = replaceEdit(src, 6, 11, dest, 6, 11);
	assert.equal(applyEdit(dest, edit), 'alpha\nBETA\n');
});

test('insert below appends the hunk without deleting the original line', () => {
	const dest = 'alpha\nbeta\n';
	const src = 'alpha\nBETA\n';
	const insert = hunkText(src, 6, 11);
	const edit = { from: 11, to: 11, insert };
	assert.equal(applyEdit(dest, edit), 'alpha\nbeta\nBETA\n');
});

test('insert above leaves the existing hunk in place', () => {
	const dest = 'alpha\nbeta\n';
	const insert = hunkText('alpha\nBETA\n', 6, 11);
	assert.equal(applyEdit(dest, { from: 6, to: 6, insert }), 'alpha\nBETA\nbeta\n');
});

test('delete removes the hunk and does not glue the neighbors', () => {
	const dest = 'alpha\nbeta\ngamma\n';
	assert.equal(applyEdit(dest, deleteEdit(dest, 6, 11)), 'alpha\ngamma\n');
});

test('a mid-line delete keeps a newline instead of joining the sides', () => {
	assert.equal(applyEdit('abXcd', deleteEdit('abXcd', 2, 3)), 'ab\ncd');
});

test('chunk kind follows which side is empty', () => {
	assert.equal(chunkKind({ fromA: 0, toA: 0, fromB: 0, toB: 4 }), 'insert');
	assert.equal(chunkKind({ fromA: 0, toA: 4, fromB: 1, toB: 1 }), 'delete');
	assert.equal(chunkKind({ fromA: 0, toA: 4, fromB: 0, toB: 4 }), 'change');
});

test('prepend and append need text on both sides', () => {
	assert.equal(hunkHasBothSides({ fromA: 0, toA: 4, fromB: 0, toB: 4 }), true);
	assert.equal(hunkHasBothSides({ fromA: 0, toA: 4, fromB: 1, toB: 1 }), false);
	assert.equal(hunkHasBothSides({ fromA: 0, toA: 0, fromB: 0, toB: 4 }), false);
});
