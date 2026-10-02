import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alignedDocPos, armedCaption, buildSummary, docPosAtScroll, idleCaption, scrollTopForPos, stepChunk } from '../src/diff/mobile-model';
import { mergeSettings } from '../src/settings';

test('idle caption names the hunk and an empty side', () => {
	const caption = idleCaption('adipiscing\n', '', { fromA: 0, toA: 11, fromB: 0, toB: 0 });
	assert.equal(caption, 'Hunk: adipiscing → (nothing on B)');
});

test('replace caption quotes both sides, and an empty destination is an insert', () => {
	const chunk = { fromA: 0, toA: 11, fromB: 0, toB: 5 };
	assert.equal(
		armedCaption('replace-right', 'adipiscing\n', 'amet\n', chunk),
		'Replace B: “amet” will become “adipiscing”',
	);
	assert.equal(
		armedCaption('replace-right', 'adipiscing\n', 'keep\n', { fromA: 0, toA: 11, fromB: 5, toB: 5 }),
		'Insert on B',
	);
});

test('summary keeps unchanged text and counts token changes', () => {
	const summary = buildSummary('alpha\nONLY\ngamma\n', 'alpha\ngamma\n', [
		{ fromA: 6, toA: 11, fromB: 6, toB: 6, changes: [{ fromA: 0, toA: 4, fromB: 0, toB: 0 }] },
	]);
	assert.equal(summary.spans.map((span) => span.text).join(''), 'alpha\nONLY\ngamma\n');
	assert.equal(summary.removed, 4);
	assert.equal(summary.added, 0);
	assert.equal(summary.spans.filter((span) => span.kind === 'delete').length, 1);
});

test('summary shows a change as a deletion followed by an insertion', () => {
	const summary = buildSummary('alpha\namet\n', 'alpha\nadipiscing\n', [
		{ fromA: 6, toA: 11, fromB: 6, toB: 17 },
	]);
	assert.deepEqual(summary.spans.map((span) => span.kind), ['same', 'delete', 'insert']);
	assert.equal(summary.spans.map((span) => span.text).join(''), 'alpha\namet\nadipiscing\n');
});

test('aligned positions follow the other side through a deletion', () => {
	const chunks = [{ fromA: 6, toA: 11, fromB: 6, toB: 6 }];
	assert.equal(alignedDocPos(chunks, 'a', 0), 0);
	assert.equal(alignedDocPos(chunks, 'a', 8), 6);
	assert.equal(alignedDocPos(chunks, 'a', 11), 6);
	assert.equal(alignedDocPos(chunks, 'a', 12), 7);
});

test('scroll offset moves through a wrapped paragraph instead of sticking to its start', () => {
	const paragraph = { from: 0, to: 400, top: 0, height: 1000 };
	assert.equal(docPosAtScroll(0, paragraph), 0);
	assert.equal(docPosAtScroll(250, paragraph), 100);
	assert.equal(docPosAtScroll(1000, paragraph), 400);
	assert.equal(docPosAtScroll(1400, paragraph), 400);
	const other = { from: 0, to: 400, top: 0, height: 500 };
	assert.equal(scrollTopForPos(docPosAtScroll(250, paragraph), other), 125);
	assert.equal(scrollTopForPos(docPosAtScroll(0, paragraph), other), 0);
});

test('scroll sync round-trips through lines of different height', () => {
	const source = { from: 0, to: 400, top: 0, height: 1000 };
	const dest = { from: 10, to: 410, top: 20, height: 500 };
	const mapped = docPosAtScroll(250, source) + 10;
	const top = scrollTopForPos(mapped, dest);
	assert.equal(top, 145);
	const back = scrollTopForPos(docPosAtScroll(top, dest) - 10, source);
	assert.equal(back, 250);
});

test('prev and next step through chunks from the cursor', () => {
	const chunks = [
		{ fromA: 10, toA: 15, fromB: 10, toB: 15 },
		{ fromA: 30, toA: 34, fromB: 30, toB: 34 },
	];
	assert.equal(stepChunk(chunks, 'a', 0, 1), 0);
	assert.equal(stepChunk(chunks, 'a', 12, 1), 1);
	assert.equal(stepChunk(chunks, 'a', 12, -1), -1);
	assert.equal(stepChunk(chunks, 'a', 20, -1), 0);
	assert.equal(stepChunk(chunks, 'a', 40, 1), -1);
});

test('force mobile layout defaults off and round-trips', () => {
	assert.equal(mergeSettings(null).forceMobileLayout, false);
	assert.equal(mergeSettings({ forceMobileLayout: true }).forceMobileLayout, true);
});
