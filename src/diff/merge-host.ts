import { goToNextChunk, goToPreviousChunk, MergeView } from '@codemirror/merge';
import { EditorView } from '@codemirror/view';
import { Menu, Notice } from 'obsidian';
import { isMarkdownPath } from '../text-util';
import { activeLineExtensions, createCompartments, lineNumberExtensions, paneExtensions, type PaneCompartments } from './editor-extensions';
import { whitespaceExtensions } from './whitespace';
import { HUNK_ACTION_LABELS, applyHunkAction, chunkAtCursor, type HunkAction } from './hunk-actions';
import { LinkMap } from './link-map';
import type { RangeChunk } from './hunk-text';

export interface SurfacePane {
	text: string;
	path: string | null;
	readOnly: boolean;
	placeholder: string | null;
	detail: string;
}

export interface SurfaceOptions {
	wrap: boolean;
	showCurrentLine: boolean;
	showLineNumbers: boolean;
	showWhitespace: boolean;
	highlight: boolean;
	collapse: boolean;
	collapseMargin: number;
	scanLimit: number;
	dark: boolean;
	tabSize: number;
	useTab: boolean;
	aligned: boolean;
}

export interface SurfaceHandlers {
	onDoc: (side: 'left' | 'right', text: string) => void;
	onFocus: (side: 'left' | 'right') => void;
	onSave: (which: 'left' | 'right' | 'both') => void;
	onChunks: (count: number) => void;
}

interface LiveEditor {
	view: EditorView;
	slots: PaneCompartments;
}

export class DiffSurface {
	private merge: MergeView | null = null;
	private left: LiveEditor | null = null;
	private right: LiveEditor | null = null;
	private link: LinkMap | null = null;
	private options: SurfaceOptions;
	private aligned = true;
	private readOnly = { left: false, right: false };
	private kinds: { left: boolean; right: boolean } | null = null;
	private readonly root: HTMLElement;
	private scrollCleanups: (() => void)[] = [];

	constructor(
		parent: HTMLElement,
		private readonly handlers: SurfaceHandlers,
	) {
		this.root = parent.createDiv({ cls: 'meld-surface is-aligned' });
		this.options = {
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
		};
	}

	/** Show a pair. Reuses the open editors when it can, and writes the new text into them. */
	show(left: SurfacePane, right: SurfacePane, options: SurfaceOptions): void {
		if (this.canReuse(left, right, options) && this.merge && this.left && this.right) {
			this.options = options;
			this.aligned = options.aligned;
			this.readOnly = { left: left.readOnly, right: right.readOnly };
			this.root.toggleClass('is-aligned', options.aligned);
			this.merge.reconfigure({
				highlightChanges: options.highlight,
				gutter: false,
				collapseUnchanged: options.collapse ? { margin: options.collapseMargin } : undefined,
				diffConfig: { scanLimit: options.scanLimit },
			});
			this.replaceSide(this.left, left);
			this.replaceSide(this.right, right);
			this.handlers.onChunks(this.merge.chunks.length);
			this.link?.schedule();
			return;
		}
		this.set(left, right, options);
	}

	set(left: SurfacePane, right: SurfacePane, options: SurfaceOptions): void {
		try {
			this.destroyEditors();
		} catch (error) {
			console.error('Meld Diff: could not close the editors', error);
			this.merge = null;
			this.left = null;
			this.right = null;
			this.link = null;
		}
		this.options = options;
		this.aligned = options.aligned;
		this.readOnly = { left: left.readOnly, right: right.readOnly };
		this.kinds = { left: isMarkdownPath(left.path), right: isMarkdownPath(right.path) };
		this.root.toggleClass('is-aligned', options.aligned);
		this.root.empty();
		if (!left.placeholder && !right.placeholder) {
			this.mountMerge(left, right);
			return;
		}
		this.kinds = null;
		this.mountSplit(left, right);
	}

	private canReuse(left: SurfacePane, right: SurfacePane, options: SurfaceOptions): boolean {
		if (!this.merge || !this.left || !this.right || !this.kinds) return false;
		if (left.placeholder || right.placeholder) return false;
		if (options.scanLimit !== this.options.scanLimit) return false;
		return this.kinds.left === isMarkdownPath(left.path) && this.kinds.right === isMarkdownPath(right.path);
	}

	private replaceSide(live: LiveEditor, pane: SurfacePane): void {
		const view = live.view;
		const editable = live.slots.editable.reconfigure(EditorView.editable.of(!pane.readOnly));
		const current = view.state.doc.toString();
		if (current === pane.text) {
			view.dispatch({ effects: editable });
			return;
		}
		view.dispatch({
			changes: { from: 0, to: view.state.doc.length, insert: pane.text },
			effects: editable,
			userEvent: 'meld.load',
		});
	}

	reconfigure(partial: Partial<SurfaceOptions>): void {
		this.options = { ...this.options, ...partial };
		if (partial.aligned !== undefined) {
			this.aligned = partial.aligned;
			this.root.toggleClass('is-aligned', this.aligned);
		}
		const wrapExt = (on: boolean) => (on ? EditorView.lineWrapping : []);
		const darkExt = (on: boolean) => EditorView.darkTheme.of(on);
		for (const live of [this.left, this.right]) {
			if (!live) continue;
			const effects = [];
			if (partial.wrap !== undefined) effects.push(live.slots.wrap.reconfigure(wrapExt(this.options.wrap)));
			if (partial.showLineNumbers !== undefined) effects.push(live.slots.lineNumbers.reconfigure(lineNumberExtensions(this.options.showLineNumbers)));
			if (partial.showWhitespace !== undefined) effects.push(live.slots.whitespace.reconfigure(whitespaceExtensions(this.options.showWhitespace)));
			if (partial.showCurrentLine !== undefined || partial.showLineNumbers !== undefined) {
				effects.push(live.slots.activeLine.reconfigure(activeLineExtensions(this.options.showCurrentLine, this.options.showLineNumbers)));
			}
			if (partial.dark !== undefined) effects.push(live.slots.dark.reconfigure(darkExt(this.options.dark)));
			if (effects.length) live.view.dispatch({ effects });
		}
		if (this.merge && (partial.highlight !== undefined || partial.collapse !== undefined || partial.collapseMargin !== undefined)) {
			this.merge.reconfigure({
				highlightChanges: this.options.highlight,
				gutter: false,
				collapseUnchanged: this.options.collapse ? { margin: this.options.collapseMargin } : undefined,
			});
		}
		this.link?.schedule();
	}

	chunkCount(): number {
		return this.merge?.chunks.length ?? 0;
	}

	getText(side: 'left' | 'right'): string {
		const live = side === 'left' ? this.left : this.right;
		return live?.view.state.doc.toString() ?? '';
	}

	next(): boolean {
		return this.jump(1);
	}

	prev(): boolean {
		return this.jump(-1);
	}

	runAtCursor(action: HunkAction): void {
		if (!this.merge || !this.left || !this.right) {
			new Notice('Open two text files to edit changes.');
			return;
		}
		const focused = this.right.view.hasFocus ? this.right.view : this.left.view;
		const side = focused === this.right.view ? 'b' : 'a';
		const chunk = chunkAtCursor(this.merge.chunks, side, focused);
		if (!chunk) {
			new Notice('No change at the cursor.');
			return;
		}
		this.run(action, chunk);
	}

	copyAll(direction: 'to-left' | 'to-right'): void {
		if (!this.merge) {
			new Notice('Open two text files to copy changes.');
			return;
		}
		const chunks = [...this.merge.chunks].reverse();
		const action: HunkAction = direction === 'to-left' ? 'replace-left' : 'replace-right';
		for (const chunk of chunks) this.run(action, chunk);
	}

	destroy(): void {
		this.destroyEditors();
		this.root.remove();
	}

	private mountMerge(left: SurfacePane, right: SurfacePane): void {
		const leftSlots = createCompartments();
		const rightSlots = createCompartments();
		const merge = new MergeView({
			a: { doc: left.text, extensions: this.extensions('left', left, leftSlots) },
			b: { doc: right.text, extensions: this.extensions('right', right, rightSlots) },
			parent: this.root,
			highlightChanges: this.options.highlight,
			gutter: false,
			orientation: 'a-b',
			diffConfig: { scanLimit: this.options.scanLimit },
			collapseUnchanged: this.options.collapse ? { margin: this.options.collapseMargin } : undefined,
		});
		this.merge = merge;
		this.left = { view: merge.a, slots: leftSlots };
		this.right = { view: merge.b, slots: rightSlots };
		const editors = merge.dom.querySelector('.cm-mergeViewEditors');
		const panes = editors ? Array.from(editors.children).filter((node): node is HTMLElement => node instanceof HTMLElement && node.classList.contains('cm-mergeViewEditor')) : [];
		const column = document.createElement('div');
		column.className = 'meld-link-column';
		const rightPane = panes[1];
		if (editors && rightPane) editors.insertBefore(column, rightPane);
		else editors?.appendChild(column);
		this.link = new LinkMap(column, () => this.linkModel(), {
			run: (action, chunk) => this.run(action, chunk),
			reveal: (chunk) => this.reveal(chunk),
		});
		column.addEventListener('meld-hunk-menu', (event) => {
			const detail = (event as CustomEvent<{ chunk: RangeChunk; event: MouseEvent }>).detail;
			this.showHunkMenu(detail.chunk, detail.event);
		});
		this.bindScroll();
		this.handlers.onChunks(merge.chunks.length);
		this.link.schedule();
		window.setTimeout(() => this.link?.schedule(), 60);
	}

	private mountSplit(left: SurfacePane, right: SurfacePane): void {
		const row = this.root.createDiv({ cls: 'meld-split' });
		this.left = this.mountPane(row, 'left', left);
		this.right = this.mountPane(row, 'right', right);
		this.handlers.onChunks(0);
	}

	private mountPane(row: HTMLElement, side: 'left' | 'right', pane: SurfacePane): LiveEditor | null {
		const host = row.createDiv({ cls: 'meld-pane' });
		if (pane.placeholder) {
			const box = host.createDiv({ cls: 'meld-pane-placeholder' });
			box.createDiv({ cls: 'meld-placeholder-title', text: pane.placeholder });
			if (pane.detail) box.createDiv({ cls: 'meld-placeholder-detail', text: pane.detail });
			return null;
		}
		const slots = createCompartments();
		const view = new EditorView({
			doc: pane.text,
			extensions: this.extensions(side, pane, slots),
			parent: host,
		});
		return { view, slots };
	}

	private extensions(side: 'left' | 'right', pane: SurfacePane, slots: PaneCompartments) {
		return paneExtensions({
			path: pane.path,
			wrap: this.options.wrap,
			showCurrentLine: this.options.showCurrentLine,
			showLineNumbers: this.options.showLineNumbers,
			showWhitespace: this.options.showWhitespace,
			readOnly: pane.readOnly,
			dark: this.options.dark,
			tabSize: this.options.tabSize,
			useTab: this.options.useTab,
			compartments: slots,
			keys: {
				onSave: () => {
					this.handlers.onSave(side);
					return true;
				},
				onSaveBoth: () => {
					this.handlers.onSave('both');
					return true;
				},
				onNext: () => this.jump(1),
				onPrev: () => this.jump(-1),
				onDoc: (text) => {
					this.handlers.onDoc(side, text);
					this.handlers.onChunks(this.merge?.chunks.length ?? 0);
					this.link?.schedule();
				},
				onFocus: () => this.handlers.onFocus(side),
				onContextMenu: (event, view) => this.onContextMenu(event, view),
			},
		});
	}

	private linkModel() {
		if (!this.merge) return null;
		const scrollA = this.aligned ? this.merge.dom.scrollTop : this.merge.a.scrollDOM.scrollTop;
		const scrollB = this.aligned ? this.merge.dom.scrollTop : this.merge.b.scrollDOM.scrollTop;
		return { a: this.merge.a, b: this.merge.b, chunks: this.merge.chunks, scrollA, scrollB };
	}

	private bindScroll(): void {
		for (const cleanup of this.scrollCleanups) cleanup();
		this.scrollCleanups = [];
		if (!this.merge) return;
		const redraw = () => this.link?.schedule();
		this.merge.dom.addEventListener('scroll', redraw, { passive: true });
		this.merge.a.scrollDOM.addEventListener('scroll', redraw, { passive: true });
		this.merge.b.scrollDOM.addEventListener('scroll', redraw, { passive: true });
		const observer = new ResizeObserver(() => redraw());
		observer.observe(this.root);
		this.scrollCleanups.push(() => {
			this.merge?.dom.removeEventListener('scroll', redraw);
			this.merge?.a.scrollDOM.removeEventListener('scroll', redraw);
			this.merge?.b.scrollDOM.removeEventListener('scroll', redraw);
			observer.disconnect();
		});
	}

	private jump(dir: 1 | -1): boolean {
		if (!this.merge || !this.left || !this.right) return false;
		const view = this.right.view.hasFocus ? this.right.view : this.left.view;
		const moved = dir > 0 ? goToNextChunk(view) : goToPreviousChunk(view);
		if (!moved) return false;
		this.scrollTo(view, view.state.selection.main.head);
		view.focus();
		return true;
	}

	private scrollTo(view: EditorView, pos: number): void {
		if (!this.merge) return;
		const top = view.lineBlockAt(pos).top;
		if (this.aligned) {
			this.merge.dom.scrollTop = Math.max(0, top - this.merge.dom.clientHeight * 0.3);
			return;
		}
		view.scrollDOM.scrollTop = Math.max(0, top - view.scrollDOM.clientHeight * 0.3);
	}

	private reveal(chunk: RangeChunk): void {
		if (!this.merge) return;
		const useLeft = chunk.fromA !== chunk.toA;
		const view = useLeft ? this.merge.a : this.merge.b;
		const pos = useLeft ? chunk.fromA : chunk.fromB;
		view.dispatch({ selection: { anchor: Math.min(pos, view.state.doc.length) } });
		this.scrollTo(view, pos);
		view.focus();
	}

	private run(action: HunkAction, chunk: RangeChunk): void {
		if (!this.merge) {
			new Notice('Open two text files to edit changes.');
			return;
		}
		const affectsLeft = action.endsWith('left');
		if (affectsLeft && this.readOnly.left) {
			new Notice('The left file is read-only.');
			return;
		}
		if (!affectsLeft && this.readOnly.right) {
			new Notice('The right file is read-only.');
			return;
		}
		applyHunkAction(action, this.merge.a, this.merge.b, chunk);
	}

	private onContextMenu(event: MouseEvent, view: EditorView): boolean {
		if (!this.merge) return false;
		const side = view === this.merge.b ? 'b' : 'a';
		const chunk = chunkAtCursor(this.merge.chunks, side, view);
		if (!chunk) return false;
		event.preventDefault();
		this.showHunkMenu(chunk, event);
		return true;
	}

	private showHunkMenu(chunk: RangeChunk, event: MouseEvent): void {
		const menu = new Menu();
		for (const action of Object.keys(HUNK_ACTION_LABELS) as HunkAction[]) {
			const label = HUNK_ACTION_LABELS[action];
			menu.addItem((item) => item.setTitle(label).onClick(() => this.run(action, chunk)));
		}
		menu.showAtMouseEvent(event);
	}

	private destroyEditors(): void {
		for (const cleanup of this.scrollCleanups) cleanup();
		this.scrollCleanups = [];
		this.link?.destroy();
		this.link = null;
		const merge = this.merge;
		const left = this.left;
		const right = this.right;
		this.merge = null;
		this.left = null;
		this.right = null;
		if (merge) merge.destroy();
		else {
			left?.view.destroy();
			if (right && right !== left) right.view.destroy();
		}
	}
}
