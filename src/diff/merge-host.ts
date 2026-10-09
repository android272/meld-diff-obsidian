import { goToNextChunk, goToPreviousChunk, MergeView } from '@codemirror/merge';
import { EditorView } from '@codemirror/view';
import { Menu, Notice } from 'obsidian';
import { isMarkdownPath } from '../text-util';
import { createCompartments, paneChromeEffects, paneExtensions, type PaneCompartments } from './editor-extensions';
import { HUNK_ACTION_LABELS, applyHunkAction, chunkAtCursor, copyAllChunks, editAtCursor, type HunkAction } from './hunk-actions';
import { LinkMap } from './link-map';
import { hunkWriteAllowed, readOnlyNotice, type RangeChunk } from './hunk-text';
import { defaultSurfaceOptions, fillPlaceholder, replacePaneDocument, surfaceCanReuse } from './surface-shared';

export interface SurfacePane {
	text: string;
	path: string | null;
	readOnly: boolean;
	placeholder: string | null;
	detail: string;
	/** Muted hint drawn in an empty editor. Null once that side has a file or any text. */
	emptyHint: string | null;
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
	onSelect?: () => void;
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
		this.options = defaultSurfaceOptions();
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
		return surfaceCanReuse(
			!!(this.merge && this.left && this.right),
			this.kinds,
			left,
			right,
			options.scanLimit,
			this.options.scanLimit,
		);
	}

	private replaceSide(live: LiveEditor, pane: SurfacePane): void {
		replacePaneDocument(live.view, live.slots, pane);
	}

	reconfigure(partial: Partial<SurfaceOptions>): void {
		this.options = { ...this.options, ...partial };
		if (partial.aligned !== undefined) {
			this.aligned = partial.aligned;
			this.root.toggleClass('is-aligned', this.aligned);
		}
		for (const live of [this.left, this.right]) {
			if (!live) continue;
			const effects = paneChromeEffects(live.slots, this.options, partial);
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
		const ready = this.merge && this.left && this.right ? this.merge : null;
		editAtCursor(
			ready && this.left ? this.left.view : null,
			ready && this.right ? this.right.view : null,
			ready ? ready.chunks : [],
			action,
			(next, chunk) => this.run(next, chunk),
		);
	}

	copyAll(direction: 'to-left' | 'to-right'): void {
		copyAllChunks(this.merge ? this.merge.chunks : null, direction, (action, chunk) => this.run(action, chunk));
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
		const panes = editors ? Array.from(editors.children).filter((node): node is HTMLElement => node.instanceOf(HTMLElement) && node.classList.contains('cm-mergeViewEditor')) : [];
		const column = createDiv({ cls: 'meld-link-column' });
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
			fillPlaceholder(host, pane.placeholder, pane.detail);
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
			emptyHint: pane.emptyHint,
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
		const notice = readOnlyNotice(action, this.readOnly, {
			left: 'File A is read-only.',
			right: 'File B is read-only.',
		});
		if (notice) {
			new Notice(notice);
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
			if (action.startsWith('insert-') && !hunkWriteAllowed(action, chunk)) continue;
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
