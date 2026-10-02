import { setIcon } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import { chunkKind, type RangeChunk } from './hunk-text';
import type { HunkAction } from './hunk-actions';

export type ModifierMode = 'replace' | 'delete' | 'insert';

export function modifierMode(event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): ModifierMode {
	if (event.shiftKey) return 'delete';
	if (event.ctrlKey || event.metaKey) return 'insert';
	return 'replace';
}

interface LinkModel {
	a: EditorView;
	b: EditorView;
	chunks: readonly RangeChunk[];
	scrollA: number;
	scrollB: number;
}

export interface LinkMapActions {
	run: (action: HunkAction, chunk: RangeChunk) => void;
	reveal: (chunk: RangeChunk) => void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function span(view: EditorView, from: number, to: number): { top: number; bottom: number } {
	const doc = view.state.doc;
	const start = Math.max(0, Math.min(from, doc.length));
	const end = Math.max(start, Math.min(Math.max(from, to - 1), doc.length));
	const first = view.lineBlockAt(start);
	const last = view.lineBlockAt(end);
	let top = Math.min(first.top, last.top);
	let bottom = Math.max(first.bottom, last.bottom);
	if (bottom - top < 6) {
		const mid = (top + bottom) / 2;
		top = mid - 3;
		bottom = mid + 3;
	}
	return { top, bottom };
}

interface HunkShape {
	fill: string;
	outline: string;
	top: number;
}

/**
 * How far to pull the wave back from the text.
 * With no gutter, 0 meets the highlight. With line numbers, the gutter's edge
 * sits a fraction of a pixel into the highlight, so the same 0 overlaps and
 * leaves a bright line. 0.25 keeps that case flush without opening a gap.
 */
function seamInset(view: EditorView): number {
	const gutter = view.dom.querySelector('.cm-gutters');
	if (!gutter) return 0;
	return gutter.getBoundingClientRect().width >= 2 ? 0.25 : 0;
}

/** One filled bridge plus an outline that wraps both changed regions and the wave. */
function hunkShape(
	l0: number,
	l1: number,
	r0: number,
	r1: number,
	yLT: number,
	yLB: number,
	yRT: number,
	yRB: number,
	insetLeft: number,
	insetRight: number,
): HunkShape {
	const mid = (l1 + r0) / 2;
	const fillL = l1 + insetLeft;
	const fillR = r0 - insetRight;
	const fill = `M ${fillL} ${yLT} L ${l1} ${yLT} C ${mid} ${yLT} ${mid} ${yRT} ${r0} ${yRT} L ${fillR} ${yRT} L ${fillR} ${yRB} L ${r0} ${yRB} C ${mid} ${yRB} ${mid} ${yLB} ${l1} ${yLB} L ${fillL} ${yLB} Z`;
	const outline = `M ${l0} ${yLT} L ${l1} ${yLT} C ${mid} ${yLT} ${mid} ${yRT} ${r0} ${yRT} L ${r1} ${yRT} L ${r1} ${yRB} L ${r0} ${yRB} C ${mid} ${yRB} ${mid} ${yLB} ${l1} ${yLB} L ${l0} ${yLB} Z`;
	return { fill, outline, top: Math.min(yLT, yRT) };
}

function textEdges(view: EditorView): { left: number; right: number } {
	const scroller = view.scrollDOM;
	const scrollerRect = scroller.getBoundingClientRect();
	const contentRect = view.contentDOM.getBoundingClientRect();
	const innerLeft = scrollerRect.left + scroller.clientLeft;
	const innerRight = innerLeft + scroller.clientWidth;
	const left = Math.max(innerLeft, contentRect.left);
	const right = Math.min(innerRight, contentRect.right);
	return { left, right: Math.max(left + 1, right) };
}

/** Document Y of a hunk, in pixels below the link column's top. `documentTop` already includes the editor's 4px content padding. */
function hunkY(view: EditorView, from: number, to: number, columnTop: number): { top: number; bottom: number } {
	const block = span(view, from, to);
	const origin = view.documentTop - columnTop;
	return { top: origin + block.top, bottom: origin + block.bottom };
}

/** Pin a hunk's buttons to the top of the visible column only while some of that hunk is still on screen. */
function pinnedButtonTop(hunkTop: number, hunkBottom: number): number | null {
	if (hunkBottom <= 0) return null;
	return Math.max(0, hunkTop);
}

function actionFor(mode: ModifierMode, dir: 'left' | 'right', where: 'above' | 'below'): HunkAction {
	if (mode === 'delete') return dir === 'left' ? 'delete-left' : 'delete-right';
	if (mode === 'insert') {
		if (dir === 'left') return where === 'below' ? 'insert-below-left' : 'insert-above-left';
		return where === 'below' ? 'insert-below-right' : 'insert-above-right';
	}
	return dir === 'left' ? 'replace-left' : 'replace-right';
}

export class LinkMap {
	private readonly svg: SVGSVGElement;
	private readonly buttons: HTMLElement;
	private mode: ModifierMode = 'replace';
	private frame = 0;
	private popover: HTMLElement | null = null;
	private popoverCloser: ((event: MouseEvent) => void) | null = null;
	private readonly cleanups: (() => void)[] = [];

	constructor(
		private readonly host: HTMLElement,
		private readonly model: () => LinkModel | null,
		private readonly actions: LinkMapActions,
	) {
		this.svg = document.createElementNS(SVG_NS, 'svg');
		this.svg.classList.add('meld-link-svg');
		this.buttons = document.createElement('div');
		this.buttons.className = 'meld-link-buttons';
		host.appendChild(this.svg);
		host.appendChild(this.buttons);
		const viewWindow = host.ownerDocument.defaultView ?? window;
		const onKey = (event: KeyboardEvent) => this.setMode(modifierMode(event));
		const onBlur = () => this.setMode('replace');
		viewWindow.addEventListener('keydown', onKey);
		viewWindow.addEventListener('keyup', onKey);
		viewWindow.addEventListener('blur', onBlur);
		this.cleanups.push(() => {
			viewWindow.removeEventListener('keydown', onKey);
			viewWindow.removeEventListener('keyup', onKey);
			viewWindow.removeEventListener('blur', onBlur);
		});
	}

	schedule(): void {
		if (this.frame) return;
		const viewWindow = this.host.ownerDocument.defaultView ?? window;
		this.frame = viewWindow.requestAnimationFrame(() => {
			this.frame = 0;
			this.redraw();
		});
	}

	setMode(mode: ModifierMode): void {
		if (mode === this.mode) return;
		this.mode = mode;
		this.redraw();
	}

	redraw(): void {
		const model = this.model();
		this.svg.replaceChildren();
		if (!model) {
			this.buttons.replaceChildren();
			return;
		}
		this.fitColumn();
		const height = this.host.clientHeight || 1;
		const columnRect = this.host.getBoundingClientRect();
		const leftEdge = textEdges(model.a);
		const rightEdge = textEdges(model.b);
		const svgLeft = leftEdge.left - columnRect.left;
		const svgWidth = Math.max(columnRect.width || 48, rightEdge.right - leftEdge.left);
		const x = (screenX: number) => screenX - leftEdge.left;
		this.svg.style.left = `${svgLeft}px`;
		this.svg.style.width = `${svgWidth}px`;
		this.svg.setAttribute('width', String(svgWidth));
		this.svg.setAttribute('height', String(height));
		this.svg.setAttribute('viewBox', `0 0 ${svgWidth} ${height}`);
		const anchors: Array<{ top: number; bottom: number }> = [];
		model.chunks.forEach((chunk) => {
			const left = hunkY(model.a, chunk.fromA, chunk.toA, columnRect.top);
			const right = hunkY(model.b, chunk.fromB, chunk.toB, columnRect.top);
			const shape = hunkShape(
				x(leftEdge.left),
				x(leftEdge.right),
				x(rightEdge.left),
				x(rightEdge.right),
				left.top,
				left.bottom,
				right.top,
				right.bottom,
				seamInset(model.a),
				seamInset(model.b),
			);
			anchors.push({ top: shape.top, bottom: Math.max(left.bottom, right.bottom) });
			const kind = chunkKind(chunk);
			const fill = document.createElementNS(SVG_NS, 'path');
			fill.setAttribute('d', shape.fill);
			fill.classList.add('meld-wave', `meld-wave-${kind}`);
			const outline = document.createElementNS(SVG_NS, 'path');
			outline.setAttribute('d', shape.outline);
			outline.classList.add('meld-hunk-outline', `meld-hunk-outline-${kind}`);
			const markHot = (hot: boolean) => {
				fill.classList.toggle('is-hot', hot);
				outline.classList.toggle('is-hot', hot);
			};
			fill.addEventListener('mouseenter', () => markHot(true));
			fill.addEventListener('mouseleave', () => markHot(false));
			fill.addEventListener('click', (event) => {
				event.preventDefault();
				this.actions.reveal(chunk);
			});
			fill.addEventListener('contextmenu', (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.actions.reveal(chunk);
				this.host.dispatchEvent(new CustomEvent('meld-hunk-menu', { detail: { chunk, event }, bubbles: true }));
			});
			this.svg.append(fill, outline);
		});
		this.renderButtons(anchors);
	}

	destroy(): void {
		const viewWindow = this.host.ownerDocument.defaultView ?? window;
		if (this.frame) viewWindow.cancelAnimationFrame(this.frame);
		this.frame = 0;
		for (const cleanup of this.cleanups) cleanup();
		this.closePopover();
		this.host.replaceChildren();
	}

	/** In aligned mode the editors grow with the file and the outer view scrolls. Pin the column to that visible frame so the wave stays on screen. */
	private fitColumn(): void {
		const surface = this.host.closest('.meld-surface');
		const scroller = this.host.closest('.cm-mergeView') as HTMLElement | null;
		if (surface?.classList.contains('is-aligned') && scroller && scroller.clientHeight > 0) {
			this.host.style.height = `${scroller.clientHeight}px`;
			return;
		}
		this.host.style.height = '';
	}

	private renderButtons(anchors: readonly { top: number; bottom: number }[] = []): void {
		const model = this.model();
		this.buttons.replaceChildren();
		if (!model) return;
		model.chunks.forEach((chunk, index) => {
			const anchor = anchors[index];
			const top = anchor ? pinnedButtonTop(anchor.top, anchor.bottom) : null;
			if (top === null) return;
			const row = document.createElement('div');
			row.className = 'meld-hunk-buttons';
			row.style.top = `${top}px`;
			const dirs: Array<'left' | 'right'> = this.mode === 'delete' ? ['left', 'right'] : ['right', 'left'];
			if (this.mode === 'insert') {
				for (const dir of dirs) {
					const stack = document.createElement('div');
					stack.className = 'meld-hunk-stack';
					for (const where of ['above', 'below'] as const) {
						stack.appendChild(this.makeButton(dir, where, chunk));
					}
					row.appendChild(stack);
				}
			} else {
				for (const dir of dirs) row.appendChild(this.makeButton(dir, 'above', chunk));
			}
			this.buttons.appendChild(row);
		});
	}

	private makeButton(dir: 'left' | 'right', where: 'above' | 'below', chunk: RangeChunk): HTMLButtonElement {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'meld-hunk-button clickable-icon';
		const mode = this.mode;
		const icon = mode === 'delete' ? 'trash-2' : mode === 'insert' ? (where === 'above' ? 'chevron-up' : 'chevron-down') : dir === 'left' ? 'arrow-left' : 'arrow-right';
		setIcon(button, icon);
		const side = dir === 'left' ? 'A' : 'B';
		const label = mode === 'replace'
			? (dir === 'left' ? 'Replace A with B' : 'Replace B with A')
			: mode === 'delete'
				? `Delete hunk on ${side}`
				: `Insert ${where} on ${side}`;
		button.setAttribute('aria-label', label);
		button.title = label;
		button.addEventListener('mousedown', (event) => {
			event.preventDefault();
			event.stopPropagation();
		});
		button.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			const live = modifierMode(event);
			if (live === 'insert' && mode !== 'insert') {
				this.openPopover(button, dir, chunk);
				return;
			}
			this.actions.run(actionFor(live === 'insert' ? 'insert' : live, dir, where), chunk);
		});
		return button;
	}

	private openPopover(anchor: HTMLElement, dir: 'left' | 'right', chunk: RangeChunk): void {
		this.closePopover();
		const pop = anchor.ownerDocument.createElement('div');
		pop.className = 'meld-insert-pop';
		for (const where of ['above', 'below'] as const) {
			const choice = pop.createEl('button', { text: where === 'above' ? 'Insert above' : 'Insert below' });
			choice.addEventListener('click', (event) => {
				event.preventDefault();
				this.actions.run(actionFor('insert', dir, where), chunk);
				this.closePopover();
			});
		}
		const rect = anchor.getBoundingClientRect();
		pop.style.top = `${rect.bottom + 4}px`;
		pop.style.left = `${Math.max(8, rect.left - 20)}px`;
		anchor.ownerDocument.body.appendChild(pop);
		this.popover = pop;
		const doc = anchor.ownerDocument;
		this.popoverCloser = (event: MouseEvent) => {
			if (pop.contains(event.target as Node)) return;
			this.closePopover();
		};
		doc.addEventListener('mousedown', this.popoverCloser, true);
	}

	private closePopover(): void {
		if (this.popover && this.popoverCloser) {
			this.popover.ownerDocument.removeEventListener('mousedown', this.popoverCloser, true);
		}
		this.popoverCloser = null;
		this.popover?.remove();
		this.popover = null;
	}
}
