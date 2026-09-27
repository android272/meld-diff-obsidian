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
	hover: (index: number | null) => void;
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

/** Stretch the drawing from the left text's right edge to the right text's left edge, across the scrollbar and line numbers. */
function waveBounds(column: HTMLElement, left: EditorView, right: EditorView): { left: number; width: number } {
	const columnRect = column.getBoundingClientRect();
	const width = columnRect.width || column.clientWidth || 48;
	const leftTextRight = visibleTextRight(left);
	const rightTextLeft = visibleTextLeft(right);
	// Scrollbars and line-number gutters sit between the gap and the text. Cap a bad measurement.
	const extendLeft = Math.min(96, Math.max(0, columnRect.left - leftTextRight));
	const extendRight = Math.min(96, Math.max(0, rightTextLeft - columnRect.right));
	return { left: -extendLeft, width: width + extendLeft + extendRight };
}

function visibleTextRight(view: EditorView): number {
	const rect = view.scrollDOM.getBoundingClientRect();
	return rect.left + view.scrollDOM.clientLeft + view.scrollDOM.clientWidth;
}

function visibleTextLeft(view: EditorView): number {
	const gutter = view.dom.querySelector('.cm-gutters');
	if (gutter) return gutter.getBoundingClientRect().right;
	return view.scrollDOM.getBoundingClientRect().left;
}

function wave(leftTop: number, leftBottom: number, rightTop: number, rightBottom: number, width: number): string {
	const cx = width / 2;
	return `M 0 ${leftTop} C ${cx} ${leftTop} ${cx} ${rightTop} ${width} ${rightTop} L ${width} ${rightBottom} C ${cx} ${rightBottom} ${cx} ${leftBottom} 0 ${leftBottom} Z`;
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
		this.renderButtons();
	}

	redraw(): void {
		const model = this.model();
		this.svg.replaceChildren();
		if (!model) {
			this.buttons.replaceChildren();
			return;
		}
		const height = this.host.clientHeight || 1;
		const bounds = waveBounds(this.host, model.a, model.b);
		this.svg.style.left = `${bounds.left}px`;
		this.svg.style.width = `${bounds.width}px`;
		this.svg.setAttribute('width', String(bounds.width));
		this.svg.setAttribute('height', String(height));
		this.svg.setAttribute('viewBox', `0 0 ${bounds.width} ${height}`);
		model.chunks.forEach((chunk, index) => {
			const left = span(model.a, chunk.fromA, chunk.toA);
			const right = span(model.b, chunk.fromB, chunk.toB);
			const path = document.createElementNS(SVG_NS, 'path');
			path.setAttribute('d', wave(left.top - model.scrollA, left.bottom - model.scrollA, right.top - model.scrollB, right.bottom - model.scrollB, bounds.width));
			path.classList.add('meld-wave', `meld-wave-${chunkKind(chunk)}`);
			path.addEventListener('mouseenter', () => {
				path.classList.add('is-hot');
				this.actions.hover(index);
			});
			path.addEventListener('mouseleave', () => {
				path.classList.remove('is-hot');
				this.actions.hover(null);
			});
			path.addEventListener('click', (event) => {
				event.preventDefault();
				this.actions.reveal(chunk);
			});
			path.addEventListener('contextmenu', (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.actions.reveal(chunk);
				this.host.dispatchEvent(new CustomEvent('meld-hunk-menu', { detail: { chunk, event }, bubbles: true }));
			});
			this.svg.appendChild(path);
		});
		this.renderButtons();
	}

	destroy(): void {
		const viewWindow = this.host.ownerDocument.defaultView ?? window;
		if (this.frame) viewWindow.cancelAnimationFrame(this.frame);
		this.frame = 0;
		for (const cleanup of this.cleanups) cleanup();
		this.closePopover();
		this.host.replaceChildren();
	}

	private renderButtons(): void {
		const model = this.model();
		this.buttons.replaceChildren();
		if (!model) return;
		model.chunks.forEach((chunk, index) => {
			const left = span(model.a, chunk.fromA, chunk.toA);
			const row = document.createElement('div');
			row.className = 'meld-hunk-buttons';
			row.style.top = `${Math.max(0, left.top - model.scrollA)}px`;
			const dirs: Array<'left' | 'right'> = ['left', 'right'];
			if (this.mode === 'insert') {
				for (const dir of dirs) {
					const stack = document.createElement('div');
					stack.className = 'meld-hunk-stack';
					for (const where of ['above', 'below'] as const) {
						stack.appendChild(this.makeButton(dir, where, chunk, index));
					}
					row.appendChild(stack);
				}
			} else {
				for (const dir of dirs) row.appendChild(this.makeButton(dir, 'above', chunk, index));
			}
			this.buttons.appendChild(row);
		});
	}

	private makeButton(dir: 'left' | 'right', where: 'above' | 'below', chunk: RangeChunk, index: number): HTMLButtonElement {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'meld-hunk-button clickable-icon';
		const mode = this.mode;
		const icon = mode === 'delete' ? 'trash-2' : mode === 'insert' ? (where === 'above' ? 'chevron-up' : 'chevron-down') : dir === 'left' ? 'arrow-left' : 'arrow-right';
		setIcon(button, icon);
		const label = mode === 'replace'
			? (dir === 'left' ? 'Replace left with right' : 'Replace right with left')
			: mode === 'delete'
				? (dir === 'left' ? 'Delete left hunk' : 'Delete right hunk')
				: `Insert ${where} on the ${dir}`;
		button.setAttribute('aria-label', label);
		button.title = label;
		button.addEventListener('mousedown', (event) => {
			event.preventDefault();
			event.stopPropagation();
		});
		button.addEventListener('mouseenter', () => this.actions.hover(index));
		button.addEventListener('mouseleave', () => this.actions.hover(null));
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
