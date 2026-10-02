import { Chunk } from '@codemirror/merge';
import { Compartment } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { Notice } from 'obsidian';
import { isMarkdownPath } from '../text-util';
import { activeLineExtensions, createCompartments, editorChromeEffects, lineNumberExtensions, paneExtensions, type PaneCompartments } from './editor-extensions';
import { chunkAtCursor, applyHunkAction, type HunkAction } from './hunk-actions';
import { hunkHasBothSides, type RangeChunk } from './hunk-text';
import {
	mobileArm,
	mobileChunks,
	mobileDecorationExtensions,
	mobileIntra,
	mobileSide,
	type MobileArm,
	type MobileChunk,
} from './mobile-decorations';
import { alignedDocPos, stepChunk } from './mobile-model';
import { docPosAtTop, positionDrawn, scrollTopToShow } from './scroll-sync';
import type { SurfaceHandlers, SurfaceOptions, SurfacePane } from './merge-host';
import { whitespaceExtensions } from './whitespace';

interface StackedPane {
	view: EditorView;
	slots: PaneCompartments;
	chunks: Compartment;
	intra: Compartment;
	arm: Compartment;
}

interface Armed {
	action: HunkAction;
	side: 'left' | 'right';
	chunk: RangeChunk;
}

/**
 * Two source editors stacked for the phone layout. Chunks come from the same
 * diff MergeView uses, without its side-by-side spacers or link column.
 */
export class StackedHost {
	private left: StackedPane | null = null;
	private right: StackedPane | null = null;
	private options: SurfaceOptions;
	private readOnly = { left: false, right: false };
	private kinds: { left: boolean; right: boolean } | null = null;
	private chunkList: MobileChunk[] = [];
	private armed: Armed | null = null;
	private chunkQueued = false;
	private gestureQueued = false;
	private suppress = false;
	private syncLock = false;
	/** Pane the user is scrolling. The other pane follows and must not scroll this one back. */
	private leader: 'left' | 'right' | null = null;
	private syncQueued = false;
	private cleanups: Array<() => void> = [];

	constructor(
		private readonly slots: { left: HTMLElement; right: HTMLElement },
		private readonly handlers: SurfaceHandlers,
	) {
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

	show(left: SurfacePane, right: SurfacePane, options: SurfaceOptions): void {
		if (this.canReuse(left, right, options) && this.left && this.right) {
			this.options = options;
			this.readOnly = { left: left.readOnly, right: right.readOnly };
			this.replaceSide(this.left, left);
			this.replaceSide(this.right, right);
			this.reconfigure(options);
			this.publishChunks();
			return;
		}
		this.mount(left, right, options);
	}

	reconfigure(partial: Partial<SurfaceOptions>): void {
		this.options = { ...this.options, ...partial };
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
			if (partial.highlight !== undefined) effects.push(live.intra.reconfigure(mobileIntra.of(this.options.highlight)));
			if (effects.length) live.view.dispatch({ effects });
		}
	}

	chunkCount(): number {
		return this.chunkList.length;
	}

	chunks(): readonly MobileChunk[] {
		return this.chunkList;
	}

	chunkAt(side: 'left' | 'right'): RangeChunk | null {
		const live = side === 'left' ? this.left : this.right;
		if (!live) return null;
		return chunkAtCursor(this.chunkList, side === 'left' ? 'a' : 'b', live.view);
	}

	armedOn(side: 'left' | 'right'): HunkAction | null {
		return this.armed?.side === side ? this.armed.action : null;
	}

	getText(side: 'left' | 'right'): string {
		const live = side === 'left' ? this.left : this.right;
		return live?.view.state.doc.toString() ?? '';
	}

	focus(side: 'left' | 'right'): void {
		const live = side === 'left' ? this.left : this.right;
		if (!live) return;
		live.view.focus();
		live.view.requestMeasure();
	}

	remeasure(): void {
		this.left?.view.requestMeasure();
		this.right?.view.requestMeasure();
	}

	clear(side: 'left' | 'right'): void {
		const live = side === 'left' ? this.left : this.right;
		if (!live) return;
		const length = live.view.state.doc.length;
		if (!length) return;
		this.disarm(false);
		live.view.dispatch({ changes: { from: 0, to: length, insert: '' }, userEvent: 'input' });
	}

	next(): boolean {
		return this.jump(1);
	}

	prev(): boolean {
		return this.jump(-1);
	}

	focusChunk(index: number, prefer: 'left' | 'right'): void {
		const chunk = this.chunkList[index];
		if (!chunk) return;
		this.place(chunk, prefer);
	}

	cancelArm(): void {
		if (this.armed) this.disarm(false);
	}

	/** First tap arms and previews. A second tap on the same button applies. */
	arm(action: HunkAction, side: 'left' | 'right'): 'applied' | 'armed' | 'none' {
		const chunk = this.chunkAt(side);
		if (!chunk || !this.allows(action, chunk)) return 'none';
		const affectsLeft = action.endsWith('left');
		if (affectsLeft && this.readOnly.left) {
			new Notice('The top file is read-only.');
			return 'none';
		}
		if (!affectsLeft && this.readOnly.right) {
			new Notice('The bottom file is read-only.');
			return 'none';
		}
		if (this.armed && this.armed.action === action && this.armed.side === side && sameChunk(this.armed.chunk, chunk)) {
			this.disarm(false);
			this.run(action, chunk);
			return 'applied';
		}
		this.armed = { action, side, chunk };
		this.preview(action, chunk);
		return 'armed';
	}

	runAtCursor(action: HunkAction): void {
		if (!this.left || !this.right) {
			new Notice('Open two text files to edit changes.');
			return;
		}
		const focused = this.right.view.hasFocus ? this.right.view : this.left.view;
		const side = focused === this.right.view ? 'b' : 'a';
		const chunk = chunkAtCursor(this.chunkList, side, focused);
		if (!chunk) {
			new Notice('No change at the cursor.');
			return;
		}
		this.run(action, chunk);
	}

	copyAll(direction: 'to-left' | 'to-right'): void {
		if (!this.left || !this.right) {
			new Notice('Open two text files to copy changes.');
			return;
		}
		const action: HunkAction = direction === 'to-left' ? 'replace-left' : 'replace-right';
		for (const chunk of [...this.chunkList].reverse()) this.run(action, chunk);
	}

	destroy(): void {
		this.destroyEditors();
	}

	private canReuse(left: SurfacePane, right: SurfacePane, options: SurfaceOptions): boolean {
		if (left.placeholder || right.placeholder || !this.left || !this.right || !this.kinds) return false;
		if (options.scanLimit !== this.options.scanLimit) return false;
		return this.kinds.left === isMarkdownPath(left.path) && this.kinds.right === isMarkdownPath(right.path);
	}

	private mount(left: SurfacePane, right: SurfacePane, options: SurfaceOptions): void {
		this.destroyEditors();
		this.options = options;
		this.readOnly = { left: left.readOnly, right: right.readOnly };
		this.kinds = left.placeholder || right.placeholder ? null : { left: isMarkdownPath(left.path), right: isMarkdownPath(right.path) };
		this.left = this.mountPane(this.slots.left, 'left', left);
		this.right = this.mountPane(this.slots.right, 'right', right);
		this.bindScroll();
		this.publishChunks();
	}

	private mountPane(host: HTMLElement, side: 'left' | 'right', pane: SurfacePane): StackedPane | null {
		host.empty();
		if (pane.placeholder) {
			const box = host.createDiv({ cls: 'meld-pane-placeholder' });
			box.createDiv({ cls: 'meld-placeholder-title', text: pane.placeholder });
			if (pane.detail) box.createDiv({ cls: 'meld-placeholder-detail', text: pane.detail });
			return null;
		}
		const slots = createCompartments();
		const chunks = new Compartment();
		const intra = new Compartment();
		const arm = new Compartment();
		const view = new EditorView({
			doc: pane.text,
			parent: host,
			extensions: this.extensions(side, pane, slots, chunks, intra, arm),
		});
		return { view, slots, chunks, intra, arm };
	}

	private extensions(
		side: 'left' | 'right',
		pane: SurfacePane,
		slots: PaneCompartments,
		chunks: Compartment,
		intra: Compartment,
		arm: Compartment,
	) {
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
			extra: [
				mobileSide.of(side === 'left' ? 'a' : 'b'),
				chunks.of(mobileChunks.of([])),
				intra.of(mobileIntra.of(this.options.highlight)),
				arm.of(mobileArm.of(null)),
				mobileDecorationExtensions(),
				EditorView.domEventHandlers({
					mousedown: () => {
						this.onUserGesture();
						return false;
					},
				}),
				EditorView.updateListener.of((update) => {
					if (update.docChanged) this.scheduleChunks();
					if (update.selectionSet && !this.suppress) this.queueGesture();
				}),
			],
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
				onDoc: (text) => this.handlers.onDoc(side, text),
				onFocus: () => this.handlers.onFocus(side),
				onContextMenu: () => false,
			},
		});
	}

	private replaceSide(live: StackedPane, pane: SurfacePane): void {
		const effects = editorChromeEffects(live.slots, pane.readOnly, pane.emptyHint);
		const current = live.view.state.doc.toString();
		if (current === pane.text) {
			live.view.dispatch({ effects });
			return;
		}
		this.suppress = true;
		live.view.dispatch({
			changes: { from: 0, to: live.view.state.doc.length, insert: pane.text },
			effects,
			userEvent: 'meld.load',
		});
		this.suppress = false;
	}

	private scheduleChunks(): void {
		if (this.chunkQueued) return;
		this.chunkQueued = true;
		queueMicrotask(() => {
			this.chunkQueued = false;
			this.publishChunks();
		});
	}

	private publishChunks(): void {
		if (!this.left || !this.right) {
			this.chunkList = [];
			this.handlers.onChunks(0);
			return;
		}
		try {
			this.chunkList = [...Chunk.build(this.left.view.state.doc, this.right.view.state.doc, { scanLimit: this.options.scanLimit })];
		} catch (error) {
			console.error('Meld Diff: mobile diff failed', error);
			this.chunkList = [];
		}
		this.dispatchChunks(this.left);
		this.dispatchChunks(this.right);
		if (this.armed && !this.chunkList.some((chunk) => sameChunk(chunk, this.armed?.chunk))) this.disarm(false);
		this.handlers.onChunks(this.chunkList.length);
	}

	private dispatchChunks(pane: StackedPane): void {
		pane.view.dispatch({ effects: pane.chunks.reconfigure(mobileChunks.of(this.chunkList)) });
	}

	private queueGesture(): void {
		if (this.gestureQueued) return;
		this.gestureQueued = true;
		queueMicrotask(() => {
			this.gestureQueued = false;
			this.onUserGesture();
		});
	}

	private onUserGesture(): void {
		if (this.suppress) return;
		if (this.armed) this.disarm(false);
		this.handlers.onSelect?.();
	}

	private disarm(notify: boolean): void {
		this.armed = null;
		this.suppress = true;
		for (const pane of [this.left, this.right]) {
			if (!pane) continue;
			pane.view.dispatch({ effects: pane.arm.reconfigure(mobileArm.of(null)) });
		}
		this.suppress = false;
		if (notify) this.handlers.onSelect?.();
	}

	private allows(action: HunkAction, chunk: RangeChunk): boolean {
		if (action.startsWith('insert-')) return hunkHasBothSides(chunk);
		if (action === 'delete-left') return chunk.fromA !== chunk.toA;
		if (action === 'delete-right') return chunk.fromB !== chunk.toB;
		return true;
	}

	private preview(action: HunkAction, chunk: RangeChunk): void {
		const landing = this.landing(action, chunk);
		const pane = landing.side === 'left' ? this.left : this.right;
		const other = landing.side === 'left' ? this.right : this.left;
		if (!pane) return;
		const doc = pane.view.state.doc;
		const from = Math.max(0, Math.min(landing.from, doc.length));
		const to = Math.max(from, Math.min(landing.to, doc.length));
		const caret = landing.caret || from === to;
		const arm: MobileArm = caret ? { from, to: from, caret: true } : { from, to, caret: false };
		this.suppress = true;
		this.syncLock = true;
		pane.view.dispatch({
			selection: { anchor: from },
			effects: pane.arm.reconfigure(mobileArm.of(arm)),
			scrollIntoView: true,
		});
		if (other) other.view.dispatch({ effects: other.arm.reconfigure(mobileArm.of(null)) });
		this.syncLock = false;
		this.suppress = false;
		pane.view.focus();
	}

	private landing(action: HunkAction, chunk: RangeChunk): { side: 'left' | 'right'; from: number; to: number; caret: boolean } {
		const writeLeft = action.endsWith('left');
		const side = writeLeft ? 'left' : 'right';
		const from = writeLeft ? chunk.fromA : chunk.fromB;
		const to = writeLeft ? chunk.toA : chunk.toB;
		if (action.startsWith('delete')) return { side, from, to, caret: false };
		if (action.startsWith('replace')) return { side, from, to, caret: from === to };
		if (action.startsWith('insert-above')) return { side, from, to: from, caret: true };
		const live = writeLeft ? this.left : this.right;
		const at = Math.min(live?.view.state.doc.length ?? 0, to);
		return { side, from: at, to: at, caret: true };
	}

	private jump(dir: 1 | -1): boolean {
		if (!this.left || !this.right || this.chunkList.length === 0) return false;
		const side = this.right.view.hasFocus ? 'b' : 'a';
		const view = side === 'b' ? this.right.view : this.left.view;
		const index = stepChunk(this.chunkList, side, view.state.selection.main.head, dir);
		const chunk = index >= 0 ? this.chunkList[index] : undefined;
		if (!chunk) return false;
		this.place(chunk, side === 'b' ? 'right' : 'left');
		return true;
	}

	private place(chunk: MobileChunk, prefer: 'left' | 'right'): void {
		if (!this.left || !this.right) return;
		const leftPos = Math.min(this.left.view.state.doc.length, chunk.fromA);
		const rightPos = Math.min(this.right.view.state.doc.length, chunk.fromB);
		this.suppress = true;
		this.syncLock = true;
		this.left.view.dispatch({ selection: { anchor: leftPos }, scrollIntoView: true });
		this.right.view.dispatch({ selection: { anchor: rightPos }, scrollIntoView: true });
		this.syncLock = false;
		this.suppress = false;
		(prefer === 'right' ? this.right : this.left).view.focus();
	}

	private run(action: HunkAction, chunk: RangeChunk): void {
		if (!this.left || !this.right) {
			new Notice('Open two text files to edit changes.');
			return;
		}
		const affectsLeft = action.endsWith('left');
		if (affectsLeft && this.readOnly.left) {
			new Notice('The top file is read-only.');
			return;
		}
		if (!affectsLeft && this.readOnly.right) {
			new Notice('The bottom file is read-only.');
			return;
		}
		applyHunkAction(action, this.left.view, this.right.view, chunk);
	}

	private bindScroll(): void {
		for (const cleanup of this.cleanups) cleanup();
		this.cleanups = [];
		this.watchScroll('left', this.left);
		this.watchScroll('right', this.right);
	}

	private watchScroll(side: 'left' | 'right', pane: StackedPane | null): void {
		if (!pane) return;
		const scroller = pane.view.scrollDOM;
		const claim = () => { this.leader = side; };
		const onScroll = () => this.syncFrom(side);
		scroller.addEventListener('scroll', onScroll, { passive: true });
		scroller.addEventListener('pointerdown', claim, true);
		scroller.addEventListener('wheel', claim, { capture: true, passive: true });
		scroller.addEventListener('keydown', claim, true);
		this.cleanups.push(() => {
			scroller.removeEventListener('scroll', onScroll);
			scroller.removeEventListener('pointerdown', claim, true);
			scroller.removeEventListener('wheel', claim, true);
			scroller.removeEventListener('keydown', claim, true);
		});
	}

	private syncFrom(side: 'left' | 'right'): void {
		if (!this.options.aligned || this.syncLock) return;
		if (this.leader && this.leader !== side) return;
		this.leader = side;
		if (this.syncQueued) return;
		this.syncQueued = true;
		// CodeMirror may emit this scroll event from inside its own layout pass.
		// Reading coordinates then throws, and the height it is correcting is not final yet.
		queueMicrotask(() => {
			this.syncQueued = false;
			const current = this.leader;
			if (!current) return;
			try {
				this.applyScroll(current);
			} catch (error) {
				if (!(error instanceof Error) || !error.message.includes("layout isn't allowed")) throw error;
			}
		});
	}

	private applyScroll(side: 'left' | 'right'): void {
		if (this.syncLock || !this.options.aligned || this.leader !== side) return;
		const source = side === 'left' ? this.left : this.right;
		const dest = side === 'left' ? this.right : this.left;
		if (!source || !dest) return;
		const mapped = alignedDocPos(this.chunkList, side === 'left' ? 'a' : 'b', docPosAtTop(source.view));
		const drawn = positionDrawn(dest.view, mapped);
		let top = scrollTopToShow(dest.view, mapped);
		this.syncLock = true;
		try {
			if (!drawn) {
				dest.view.scrollDOM.scrollTop = top;
				dest.view.requestMeasure();
				top = scrollTopToShow(dest.view, mapped);
			}
			if (Math.abs(dest.view.scrollDOM.scrollTop - top) >= 1) dest.view.scrollDOM.scrollTop = top;
		} finally {
			this.syncLock = false;
		}
	}

	private destroyEditors(): void {
		for (const cleanup of this.cleanups) cleanup();
		this.cleanups = [];
		this.armed = null;
		this.chunkList = [];
		const left = this.left;
		const right = this.right;
		this.left = null;
		this.right = null;
		this.kinds = null;
		left?.view.destroy();
		right?.view.destroy();
		this.slots.left.empty();
		this.slots.right.empty();
	}
}

function sameChunk(a: RangeChunk | undefined, b: RangeChunk | undefined): boolean {
	if (!a || !b) return false;
	return a.fromA === b.fromA && a.toA === b.toA && a.fromB === b.fromB && a.toB === b.toB;
}
