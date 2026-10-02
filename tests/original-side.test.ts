import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shouldFlipSides } from '../src/diff/original-side';

test('a conflict pair flips only when the original is on the wrong pane', () => {
	assert.equal(shouldFlipSides(true, 'a', true), false);
	assert.equal(shouldFlipSides(false, 'a', true), true);
	assert.equal(shouldFlipSides(true, 'b', true), true);
	assert.equal(shouldFlipSides(false, 'b', true), false);
});

test('any other loaded pair flips, and an empty diff does not', () => {
	assert.equal(shouldFlipSides(true, null, true), true);
	assert.equal(shouldFlipSides(false, null, true), true);
	assert.equal(shouldFlipSides(false, null, false), false);
	assert.equal(shouldFlipSides(true, 'a', false), false);
});
