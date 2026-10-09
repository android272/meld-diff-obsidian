import { ItemView, Menu, Notice, Scope, TFile, setIcon, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import { DIFF_VIEW_TYPE, HARD_FILE_BYTES, WARN_FILE_BYTES } from '../constants';
import { copyPlainText, openInNewTab, populateFileMenu, promptMove, promptRename, revealInNavigation, trashWithConfirm } from '../diff/file-actions';
import { pickFolder, pickVaultFile } from '../diff/file-suggest';
import type { HunkAction } from '../diff/hunk-actions';
import {
	NO_FILE_LABEL,
	NO_FILE_YET,
	diffTabTitle,
	editorFace,
	saveAsFileName,
	saveDisabledReason,
	saveEnabled,
	sideBadgeDirty,
	sideHasFile,
	sideIsDirty,
	sidesToLoad,
} from '../diff/blank-side';
import { DiffSurface, type SurfaceHandlers, type SurfaceOptions, type SurfacePane } from '../diff/merge-host';
import { wantsMobileLayout } from '../diff/mobile-mode';
import { barActions, buildSummary, cursorCaption } from '../diff/mobile-model';
import { shouldFlipSides, type OriginalPlacement } from '../diff/original-side';
import { StackedHost } from '../diff/stacked-host';
import type MeldDiffPlugin from '../main';
import { fileBarLabel, fileName, formatBytes, isBinaryExtension, joinPath, parentPath } from '../text-util';
import { askString, askUnsaved, confirm, noticeError } from '../ui/confirm';
import type { DiffViewState } from '../types';
import { MobileShell } from './mobile-shell';

type Side = 'left' | 'right';

type LeafChrome = WorkspaceLeaf & {
	updateHeader?: () => void;
	tabHeaderInnerTitleEl?: HTMLElement;
	tabHeaderEl?: HTMLElement;
	detach: () => void;
};

interface SideState {
	path: string | null;
	text: string;
	saved: string;
	binary: boolean;
	missing: boolean;
	tooBig: boolean;
	deleted: boolean;
	disk: boolean;
	size: number;
}

function emptySide(): SideState {
	return { path: null, text: '', saved: '', binary: false, missing: false, tooBig: false, deleted: false, disk: false, size: 0 };
}

function isDark(): boolean {
	return document.body.classList.contains('theme-dark');
}

function editorIndent(plugin: MeldDiffPlugin): { tabSize: number; useTab: boolean } {
	const vault = plugin.app.vault as { getConfig?: (key: string) => unknown };
	const tabSizeRaw = vault.getConfig?.('tabSize');
	const useTabRaw = vault.getConfig?.('useTab');
	const tabSize = typeof tabSizeRaw === 'number' && tabSizeRaw > 0 ? tabSizeRaw : 4;
	const useTab = typeof useTabRaw === 'boolean' ? useTabRaw : true;
	return { tabSize, useTab };
}

export class DiffView extends ItemView {
	private readonly sides: Record<Side, SideState> = { left: emptySide(), right: emptySide() };
	private focused: Side = 'left';
	private opened = false;
	private loading = false;
	private loadToken = 0;
	private loadedKey = '';
	/** False until the first pair read. Later loads read only a side whose path changed. */
	private pairLoaded = false;
	private readonly modifyToken: Record<Side, number> = { left: 0, right: 0 };
	private wasIdentical = false;
	private prompting = false;
	private appliedScan = 0;
	private surface: DiffSurface | StackedHost | null = null;
	private shell: MobileShell | null = null;
	private mobile = false;
	private keyboardBound = false;
	private countEl: HTMLElement | null = null;
	private bannerEl: HTMLElement | null = null;
	private leftLabel: HTMLElement | null = null;
	private rightLabel: HTMLElement | null = null;
	private leftSave: HTMLButtonElement | null = null;
	private rightSave: HTMLButtonElement | null = null;
	private leftBadge: HTMLElement | null = null;
	private rightBadge: HTMLElement | null = null;
	private originalDetach: (() => void) | null = null;
	private closing = false;
	private detachQueued = false;
	private closePrompt: Promise<boolean> | null = null;
	private readonly warned = new Set<string>();
	private readonly autoTimers: Record<Side, number> = { left: 0, right: 0 };
	/** Last Original-on-A value applied to this view. A change trades the two panes. */
	private originalOnA = true;

	constructor(leaf: WorkspaceLeaf, private readonly plugin: MeldDiffPlugin) {
		super(leaf);
		this.navigation = true;
		this.scope = new Scope(this.app.scope);
		this.scope.register(['Mod'], 's', () => {
			void this.saveFocused();
			return false;
		});
		this.scope.register(['Mod', 'Shift'], 's', () => {
			void this.saveBoth();
			return false;
		});
		this.scope.register(['Alt'], 'ArrowDown', () => {
			this.nextHunk();
			return false;
		});
		this.scope.register(['Alt'], 'ArrowUp', () => {
			this.prevHunk();
			return false;
		});
	}

	getViewType(): string {
		return DIFF_VIEW_TYPE;
	}

	getIcon(): string {
		return 'git-compare';
	}

	getDisplayText(): string {
		return diffTabTitle(this.sides.left.path, this.sides.right.path);
	}

	canSaveSide(side: Side): boolean {
		return saveEnabled(this.sides[side]);
	}

	getState(): Record<string, unknown> {
		return {
			leftPath: this.sides.left.path,
			rightPath: this.sides.right.path,
		};
	}

	async setState(state: unknown, _result: ViewStateResult): Promise<void> {
		const raw = (state ?? {}) as DiffViewState;
		const left = typeof raw.leftPath === 'string' ? raw.leftPath : null;
		const right = typeof raw.rightPath === 'string' ? raw.rightPath : null;
		if (this.opened) await this.loadPair(left, right, false);
		else {
			this.sides.left.path = left;
			this.sides.right.path = right;
		}
	}

	async onOpen(): Promise<void> {
		this.mobile = wantsMobileLayout(this.plugin.settings);
		this.originalOnA = this.plugin.settings.defaultLeftIsOriginal;
		this.bindKeyboard();
		this.installCloseGuard();
		this.register(this.plugin.onSettings(() => this.applySettings()));
		this.buildShell();
		this.opened = true;
		this.updateToggles();
		await this.loadPair(this.sides.left.path, this.sides.right.path, false);
	}

	private surfaceHandlers(): SurfaceHandlers {
		return {
			onDoc: (side, text) => this.onDoc(side, text),
			onFocus: (side) => {
				this.focused = side;
				this.shell?.setFocused(side);
			},
			onSave: (which) => {
				if (which === 'both') void this.saveBoth();
				else void this.save(which);
			},
			onChunks: (count) => {
				this.countEl?.setText(`Changes: ${count}`);
				if (this.shell) this.refreshMobileBars();
			},
			onSelect: () => {
				if (this.shell) this.refreshMobileBars();
			},
		};
	}

	private buildShell(): void {
		this.shell = null;
		this.leftSave = null;
		this.rightSave = null;
		this.leftBadge = null;
		this.rightBadge = null;
		this.leftLabel = null;
		this.rightLabel = null;
		this.countEl = null;
		this.bannerEl = null;
		this.contentEl.empty();
		this.contentEl.addClass('meld-diff-view');
		this.contentEl.toggleClass('is-mobile', this.mobile);
		if (!this.mobile) this.contentEl.removeClass('is-keyboard');
		if (this.mobile) this.buildMobileShell();
		else this.buildDesktopShell();
	}

	private buildDesktopShell(): void {
		const header = this.contentEl.createDiv({ cls: 'meld-diff-header' });
		const files = header.createDiv({ cls: 'meld-diff-files' });
		const leftBar = files.createDiv({ cls: 'meld-file-bar' });
		this.leftBadge = this.sideBadge(leftBar, 'A');
		this.leftLabel = this.fileButton(leftBar, 'left');
		this.moreButton(leftBar, 'left');
		this.leftSave = this.iconButton(leftBar, 'save', 'Save file A', () => { void this.save('left'); });
		this.leftSave.addClass('meld-save');
		this.iconButton(files, 'arrow-left-right', 'Swap A and B', () => this.swap());
		const rightBar = files.createDiv({ cls: 'meld-file-bar' });
		this.rightBadge = this.sideBadge(rightBar, 'B');
		this.rightLabel = this.fileButton(rightBar, 'right');
		this.moreButton(rightBar, 'right');
		this.rightSave = this.iconButton(rightBar, 'save', 'Save file B', () => { void this.save('right'); });
		this.rightSave.addClass('meld-save');
		const tools = header.createDiv({ cls: 'meld-diff-tools' });
		this.countEl = tools.createSpan({ cls: 'meld-change-count', text: 'Changes: 0' });
		this.textButton(tools, 'Prev', 'Previous change', () => this.prevHunk());
		this.textButton(tools, 'Next', 'Next change', () => this.nextHunk());
		this.textButton(tools, 'Display', 'Display options', (event) => this.openDisplayMenu(event));
		this.textButton(tools, 'to A', 'Copy all changes from B to A', () => { void this.copyAll('to-left'); });
		this.textButton(tools, 'to B', 'Copy all changes from A to B', () => { void this.copyAll('to-right'); });
		this.bannerEl = this.contentEl.createDiv({ cls: 'meld-banners' });
		const body = this.contentEl.createDiv({ cls: 'meld-diff-body' });
		this.surface = new DiffSurface(body, this.surfaceHandlers());
	}

	private buildMobileShell(): void {
		this.shell = new MobileShell(this.contentEl, {
			pick: (side) => { void this.pick(side); },
			focus: (side) => {
				this.focused = side;
				this.shell?.setFocused(side);
				if (this.surface instanceof StackedHost) this.surface.focus(side);
			},
			action: (side, action) => this.runMobileAction(side, action),
			menu: (side, event) => this.openMobileFileMenu(side, event),
			cog: (event) => this.openMobileCog(event),
			summary: () => this.openSummary(),
			prev: () => this.prevHunk(),
			next: () => this.nextHunk(),
			closeSummary: () => this.shell?.showSummary(null),
			focusChunk: (index, side) => this.focusSummaryChunk(index, side),
		});
		this.leftLabel = this.shell.label('left');
		this.rightLabel = this.shell.label('right');
		this.bannerEl = this.shell.bannerEl;
		this.surface = new StackedHost(this.shell.editors, this.surfaceHandlers());
	}

	private rebuildShell(): void {
		this.surface?.destroy();
		this.surface = null;
		this.buildShell();
		this.mount();
		this.renderChrome();
		this.refreshTitle();
	}

	private bindKeyboard(): void {
		if (this.keyboardBound) return;
		this.keyboardBound = true;
		const viewport = window.visualViewport;
		if (!viewport) return;
		const update = () => {
			const open = this.mobile && window.innerHeight - viewport.height > 140;
			this.contentEl.toggleClass('is-keyboard', open);
			if (this.surface instanceof StackedHost) this.surface.remeasure();
		};
		viewport.addEventListener('resize', update);
		this.register(() => viewport.removeEventListener('resize', update));
	}

	private runMobileAction(side: Side, action: HunkAction): void {
		if (!(this.surface instanceof StackedHost)) return;
		this.surface.arm(action, side);
		this.refreshMobileBars();
	}

	private refreshMobileBars(): void {
		if (!this.shell || !(this.surface instanceof StackedHost)) return;
		const left = this.surface.getText('left');
		const right = this.surface.getText('right');
		for (const side of ['left', 'right'] as const) {
			// No vault path still has an editor. Typed and pasted text is a diff.
			const chunk = this.surface.chunkAt(side);
			const armed = this.surface.armedOn(side);
			const caption = cursorCaption(armed, left, right, chunk);
			this.shell.setBar(side, barActions(chunk, side === 'left' ? 'a' : 'b'), armed, caption);
		}
	}

	private openSummary(): void {
		if (!(this.surface instanceof StackedHost) || !this.shell) return;
		this.surface.cancelArm();
		this.refreshMobileBars();
		this.shell.showSummary(buildSummary(this.surface.getText('left'), this.surface.getText('right'), this.surface.chunks()));
	}

	private focusSummaryChunk(index: number, side: Side): void {
		this.shell?.showSummary(null);
		if (this.surface instanceof StackedHost) this.surface.focusChunk(index, side);
		this.refreshMobileBars();
	}

	private openMobileCog(event: MouseEvent): void {
		const menu = new Menu();
		const items: Array<{ title: string; key: 'alignScroll' | 'wrapLines' | 'showIntraLine' }> = [
			{ title: 'Sync scroll', key: 'alignScroll' },
			{ title: 'Text wrapping', key: 'wrapLines' },
			{ title: 'Highlight changes inside a line', key: 'showIntraLine' },
		];
		for (const item of items) {
			menu.addItem((entry) => {
				entry.setTitle(item.title).setChecked(this.plugin.settings[item.key]).onClick(() => {
					this.plugin.settings[item.key] = !this.plugin.settings[item.key];
					void this.plugin.saveSettings(false);
				});
			});
		}
		menu.addSeparator();
		menu.addItem((entry) => entry.setTitle('Diff colors').onClick(() => this.plugin.openSettings()));
		menu.showAtMouseEvent(event);
	}

	private openMobileFileMenu(side: Side, event: MouseEvent): void {
		const menu = new Menu();
		const path = this.sides[side].path;
		const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
		const target = file instanceof TFile ? file : null;
		if (!target) menu.addItem((item) => item.setTitle('No file on this side').setDisabled(true));
		else {
			menu.addItem((item) => item.setTitle('Open in normal pane').setIcon('file').onClick(() => { void openInNewTab(this.app, target); }));
			menu.addItem((item) => item.setTitle('Reveal').setIcon('folder').onClick(() => { void revealInNavigation(this.app, target); }));
			menu.addItem((item) => item.setTitle('Rename').setIcon('pencil').onClick(() => { void promptRename(this.app, target); }));
			menu.addItem((item) => item.setTitle('Move').setIcon('folder-input').onClick(() => { void promptMove(this.app, target); }));
			menu.addItem((item) => item.setTitle('Copy path').setIcon('clipboard').onClick(() => { void copyPlainText(target.path, 'path'); }));
		}
		menu.addItem((item) => item.setTitle('Copy all text').setIcon('copy').onClick(() => {
			void copyPlainText(this.surface?.getText(side) ?? this.sides[side].text, 'file text');
		}));
		this.addSaveItem(menu, side);
		menu.addItem((item) => item.setTitle('Swap with the other side').setIcon('arrow-left-right').onClick(() => this.swap()));
		menu.addItem((item) => item.setTitle('Use this side').setIcon('replace').onClick(() => { void this.useSide(side); }));
		if (target) menu.addItem((item) => item.setTitle('Trash this file').setIcon('trash').setWarning(true).onClick(() => { void trashWithConfirm(this.app, target); }));
		menu.addSeparator();
		menu.addItem((item) => item.setTitle('Clear editor').setIcon('x').onClick(() => { void this.clearSide(side); }));
		menu.showAtMouseEvent(event);
	}

	private async useSide(side: Side): Promise<void> {
		const other: Side = side === 'left' ? 'right' : 'left';
		const source = this.sides[side].path;
		const dest = this.sides[other].path;
		if (!source || !dest) {
			new Notice('Choose a file on both sides first.');
			return;
		}
		const ok = await confirm(this.app, 'Use this side', `Overwrite ${fileName(dest)} with ${fileName(source)}?`);
		if (!ok) return;
		this.surface?.copyAll(side === 'left' ? 'to-right' : 'to-left');
		await this.save(other);
	}

	private async clearSide(side: Side): Promise<void> {
		const ok = await confirm(this.app, 'Clear editor', 'Clear this editor? The file stays until you save.');
		if (!ok || !(this.surface instanceof StackedHost)) return;
		this.surface.clear(side);
	}

	async onClose(): Promise<void> {
		this.opened = false;
		this.closing = true;
		this.restoreDetach();
		for (const side of ['left', 'right'] as const) {
			if (this.autoTimers[side]) window.clearTimeout(this.autoTimers[side]);
		}
		this.markTabUnsaved(false);
		this.surface?.destroy();
		this.surface = null;
		this.contentEl.empty();
	}

	onPaneMenu(menu: Menu, source: string): void {
		super.onPaneMenu(menu, source);
		menu.addSeparator();
		this.addSideSubmenu(menu, this.sideName('left'), 'left');
		this.addSideSubmenu(menu, this.sideName('right'), 'right');
	}

	onCssChange(): void {
		this.surface?.reconfigure({ dark: isDark() });
	}

	nextHunk(): boolean {
		return this.surface?.next() ?? false;
	}

	prevHunk(): boolean {
		return this.surface?.prev() ?? false;
	}

	swap(): void {
		for (const side of ['left', 'right'] as const) {
			if (this.autoTimers[side]) window.clearTimeout(this.autoTimers[side]);
			this.autoTimers[side] = 0;
		}
		const left = { ...this.sides.left };
		const right = { ...this.sides.right };
		this.sides.left = right;
		this.sides.right = left;
		this.loadedKey = `${this.sides.left.path ?? ''}\n${this.sides.right.path ?? ''}`;
		this.scheduleAutosave('left');
		this.scheduleAutosave('right');
		this.mount();
		this.renderChrome();
		this.refreshTitle();
		this.app.workspace.requestSaveLayout();
	}

	async saveLeft(): Promise<void> {
		await this.save('left');
	}

	async saveRight(): Promise<void> {
		await this.save('right');
	}

	async saveBoth(): Promise<void> {
		await this.save('left');
		await this.save('right');
	}

	async saveFocused(): Promise<void> {
		if (!sideHasFile(this.sides[this.focused])) {
			new Notice(NO_FILE_YET);
			return;
		}
		await this.save(this.focused);
	}

	/** Write every linked dirty side now. Unbound text is left for the user. */
	async flushLinked(): Promise<void> {
		for (const side of ['left', 'right'] as const) {
			if (this.autoTimers[side]) window.clearTimeout(this.autoTimers[side]);
			this.autoTimers[side] = 0;
			if (!sideHasFile(this.sides[side]) || !sideIsDirty(this.sides[side])) continue;
			await this.save(side);
		}
	}

	hasUnsaved(): boolean {
		return sideIsDirty(this.sides.left) || sideIsDirty(this.sides.right);
	}

	hasUnboundText(): boolean {
		return (['left', 'right'] as const).some((side) => !sideHasFile(this.sides[side]) && sideIsDirty(this.sides[side]));
	}

	/** Save or Save as, or discard, for each unsaved side. Cancel leaves the diff open. */
	resolveUnsaved(): Promise<boolean> {
		if (this.closePrompt) return this.closePrompt;
		const run = this.promptUnsaved().finally(() => {
			this.closePrompt = null;
		});
		this.closePrompt = run;
		return run;
	}

	async pickLeft(): Promise<void> {
		await this.pick('left');
	}

	async pickRight(): Promise<void> {
		await this.pick('right');
	}

	runHunk(action: HunkAction): void {
		this.surface?.runAtCursor(action);
	}

	async loadPair(left: string | null, right: string | null, prompt: boolean): Promise<void> {
		const key = `${left ?? ''}\n${right ?? ''}`;
		if (this.pairLoaded && key === this.loadedKey) return;
		const read = sidesToLoad(this.pairLoaded, this.sides.left.path, this.sides.right.path, left, right);
		if (prompt && left !== this.sides.left.path && !(await this.confirmReplace('left'))) return;
		if (prompt && right !== this.sides.right.path && !(await this.confirmReplace('right'))) return;
		const token = ++this.loadToken;
		this.loading = true;
		try {
			const nextLeft = read.left ? await this.readSide(left) : this.sides.left;
			if (token !== this.loadToken) return;
			const nextRight = read.right ? await this.readSide(right) : this.sides.right;
			if (token !== this.loadToken) return;
			this.sides.left = nextLeft;
			this.sides.right = nextRight;
			this.wasIdentical = nextLeft.text === nextRight.text;
			this.loadedKey = key;
			this.pairLoaded = true;
			this.mount();
			this.renderChrome();
			this.refreshTitle();
			this.app.workspace.requestSaveLayout();
		} finally {
			if (token === this.loadToken) this.loading = false;
		}
	}

	handleDelete(path: string): void {
		for (const side of ['left', 'right'] as const) {
			if (this.sides[side].path !== path) continue;
			this.sides[side].deleted = true;
			this.mount();
			this.renderChrome();
		}
	}

	handleRename(oldPath: string, newPath: string): void {
		let changed = false;
		for (const side of ['left', 'right'] as const) {
			if (this.sides[side].path !== oldPath) continue;
			this.sides[side].path = newPath;
			changed = true;
		}
		if (!changed) return;
		this.renderChrome();
		this.refreshTitle();
	}

	async handleModify(file: TFile): Promise<void> {
		const side = this.sideOf(file.path);
		if (!side || this.loading || this.sides[side].binary || this.sides[side].tooBig) return;
		const token = ++this.modifyToken[side];
		let disk = '';
		try {
			disk = await this.app.vault.read(file);
		} catch {
			return;
		}
		if (token !== this.modifyToken[side] || this.sideOf(file.path) !== side) return;
		const current = this.sides[side].text;
		if (disk === current) {
			this.sides[side].saved = disk;
			this.sides[side].disk = false;
			this.sides[side].missing = false;
			this.sides[side].deleted = false;
			this.renderBanners();
			return;
		}
		if (current === this.sides[side].saved) {
			this.sides[side].text = disk;
			this.sides[side].saved = disk;
			this.sides[side].disk = false;
			this.wasIdentical = this.sides.left.text === this.sides.right.text;
			this.mount();
			return;
		}
		this.sides[side].disk = true;
		this.renderBanners();
	}

	private sideOf(path: string): Side | null {
		if (this.sides.left.path === path) return 'left';
		if (this.sides.right.path === path) return 'right';
		return null;
	}

	private sideName(side: Side): 'A' | 'B' {
		return side === 'left' ? 'A' : 'B';
	}

	private async confirmReplace(side: Side): Promise<boolean> {
		if (!this.isDirty(side)) return true;
		return this.promptSide(side);
	}

	private async promptUnsaved(): Promise<boolean> {
		const discards: Side[] = [];
		for (const side of ['left', 'right'] as const) {
			if (!this.isDirty(side)) continue;
			const linked = sideHasFile(this.sides[side]);
			const choice = await askUnsaved(this.app, this.sideName(side), linked ? 'save' : 'save-as');
			if (choice === 'cancel') return false;
			if (choice === 'discard') {
				discards.push(side);
				continue;
			}
			const wrote = linked ? await this.save(side) : await this.saveAs(side);
			if (!wrote) return false;
		}
		for (const side of discards) this.acceptDiscard(side);
		return true;
	}

	private async promptSide(side: Side): Promise<boolean> {
		if (!this.isDirty(side)) return true;
		const linked = sideHasFile(this.sides[side]);
		const choice = await askUnsaved(this.app, this.sideName(side), linked ? 'save' : 'save-as');
		if (choice === 'cancel') return false;
		if (choice === 'discard') {
			this.acceptDiscard(side);
			return true;
		}
		return linked ? this.save(side) : this.saveAs(side);
	}

	private acceptDiscard(side: Side): void {
		if (this.autoTimers[side]) window.clearTimeout(this.autoTimers[side]);
		this.autoTimers[side] = 0;
		const text = this.surface?.getText(side) ?? this.sides[side].text;
		this.sides[side].text = text;
		this.sides[side].saved = text;
		this.renderSaveState();
	}

	private isDirty(side: Side): boolean {
		return sideIsDirty(this.sides[side]);
	}

	/** A linked edit stays quiet while autosave is about to write it. */
	private linkedDirtyVisible(side: Side): boolean {
		if (!sideBadgeDirty(this.sides[side])) return false;
		if (!this.plugin.settings.autosave) return true;
		return this.autoTimers[side] === 0;
	}

	private async readSide(path: string | null): Promise<SideState> {
		const blank = emptySide();
		blank.path = path;
		if (!path) return blank;
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			blank.missing = true;
			return blank;
		}
		const size = file.stat.size;
		blank.size = size;
		if (isBinaryExtension(path)) {
			blank.binary = true;
			return blank;
		}
		if (size > HARD_FILE_BYTES) {
			blank.tooBig = true;
			return blank;
		}
		if (size > WARN_FILE_BYTES && !this.warned.has(path)) {
			this.warned.add(path);
			new Notice(`Meld Diff: ${fileName(path)} is ${formatBytes(size)}. Diffing may be slow.`);
		}
		try {
			const text = await this.app.vault.read(file);
			if (text.slice(0, 8192).includes('\0')) {
				blank.binary = true;
				return blank;
			}
			blank.text = text;
			blank.saved = text;
			return blank;
		} catch (error) {
			noticeError(error, `Could not read ${path}`);
			blank.missing = true;
			return blank;
		}
	}

	private surfaceOptions(): SurfaceOptions {
		const settings = this.plugin.settings;
		const indent = editorIndent(this.plugin);
		return {
			wrap: settings.wrapLines,
			showCurrentLine: settings.showCurrentLine,
			showLineNumbers: settings.showLineNumbers,
			showWhitespace: settings.showWhitespace,
			highlight: settings.showIntraLine,
			collapse: settings.collapseUnchanged,
			collapseMargin: settings.collapseMargin,
			scanLimit: settings.scanLimit,
			dark: isDark(),
			tabSize: indent.tabSize,
			useTab: indent.useTab,
			aligned: settings.alignScroll,
		};
	}

	private mount(): void {
		if (!this.surface) return;
		const wasLoading = this.loading;
		this.loading = true;
		try {
			const options = this.surfaceOptions();
			this.appliedScan = options.scanLimit;
			this.surface.show(this.toPane('left'), this.toPane('right'), options);
			this.renderBanners();
		} finally {
			this.loading = wasLoading;
		}
	}

	private toPane(side: Side): SurfacePane {
		const state = this.sides[side];
		const face = editorFace(state, `${fileName(state.path)} · ${formatBytes(state.size)}`);
		return { path: state.path, ...face };
	}

	private onDoc(side: Side, text: string): void {
		if (this.loading) return;
		this.sides[side].text = text;
		this.scheduleAutosave(side);
		this.renderSaveState();
		void this.maybePromptIdentical();
	}

	private scheduleAutosave(side: Side): void {
		if (this.autoTimers[side]) window.clearTimeout(this.autoTimers[side]);
		this.autoTimers[side] = 0;
		if (!this.plugin.settings.autosave || !this.isDirty(side)) return;
		const path = this.sides[side].path;
		const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
		if (!(file instanceof TFile)) return;
		this.autoTimers[side] = window.setTimeout(() => {
			this.autoTimers[side] = 0;
			void this.save(side);
		}, this.plugin.settings.autosaveMs);
	}

	private async maybePromptIdentical(): Promise<void> {
		if (this.loading || this.prompting) return;
		const same = this.sides.left.text === this.sides.right.text && this.sides.left.text.length > 0;
		if (!same) {
			this.wasIdentical = false;
			return;
		}
		if (this.wasIdentical) return;
		this.wasIdentical = true;
		const conflict = this.conflictInPair();
		if (!conflict) return;
		this.prompting = true;
		const ok = await confirm(this.app, 'Files match', 'These files are identical. Delete the conflict file?');
		this.prompting = false;
		if (!ok) return;
		const file = this.app.vault.getAbstractFileByPath(conflict);
		if (file instanceof TFile) {
			try {
				await this.app.fileManager.trashFile(file);
			} catch (error) {
				noticeError(error, 'Could not delete the conflict file');
			}
		}
	}

	private conflictInPair(): string | null {
		const left = this.sides.left.path;
		const right = this.sides.right.path;
		if (!left || !right) return null;
		const index = this.plugin.index;
		if (index.isConflict(right) && index.originalFor(right) === left) return right;
		if (index.isConflict(left) && index.originalFor(left) === right) return left;
		if (index.isConflict(right) && !index.isConflict(left)) return right;
		if (index.isConflict(left) && !index.isConflict(right)) return left;
		return null;
	}

	async save(side: Side): Promise<boolean> {
		const state = this.sides[side];
		const path = state.path;
		if (!path || state.binary || state.tooBig) return false;
		const text = this.surface?.getText(side) ?? state.text;
		state.text = text;
		if (text === state.saved && !state.deleted && !state.missing) {
			this.renderSaveState();
			return true;
		}
		try {
			const existing = this.app.vault.getAbstractFileByPath(path);
			if (existing instanceof TFile) await this.app.vault.modify(existing, text);
			else if (existing) {
				new Notice('That path is a folder.');
				this.renderSaveState();
				return false;
			} else await this.app.vault.create(path, text);
			state.saved = text;
			state.deleted = false;
			state.missing = false;
			state.disk = false;
			this.renderBanners();
			this.renderSaveState();
			return true;
		} catch (error) {
			noticeError(error, 'Could not save the file');
			this.renderSaveState();
			return false;
		}
	}

	/** Ask for a folder and a name, write the buffer, and bind this side to the new note. */
	async saveAs(side: Side): Promise<boolean> {
		const state = this.sides[side];
		if (state.binary || state.tooBig) {
			new Notice('This side is not a text file.');
			return false;
		}
		const folder = await pickFolder(this.app, `Save ${this.sideName(side)} to folder`);
		if (!folder) return false;
		const suggested = state.path ? fileName(state.path) : 'Untitled.md';
		const entered = await askString(this.app, `Save ${this.sideName(side)} as`, suggested, 'Note name', 'Save');
		if (!entered) return false;
		const name = saveAsFileName(entered);
		if (!name) {
			new Notice('Enter a file name, not a path.');
			return false;
		}
		if (isBinaryExtension(name)) {
			new Notice('Choose a text note name.');
			return false;
		}
		const path = joinPath(folder.isRoot() ? '' : folder.path, name);
		if (this.app.vault.getAbstractFileByPath(path)) {
			new Notice('A file with that name is already in the folder.');
			return false;
		}
		const text = this.surface?.getText(side) ?? state.text;
		try {
			const created = await this.app.vault.create(path, text);
			state.path = path;
			state.text = text;
			state.saved = text;
			state.deleted = false;
			state.missing = false;
			state.disk = false;
			state.binary = false;
			state.tooBig = false;
			state.size = created.stat.size;
			this.loadedKey = `${this.sides.left.path ?? ''}\n${this.sides.right.path ?? ''}`;
			this.mount();
			this.renderChrome();
			this.refreshTitle();
			this.app.workspace.requestSaveLayout();
			return true;
		} catch (error) {
			noticeError(error, 'Could not save the file');
			return false;
		}
	}

	private async pick(side: Side): Promise<void> {
		const other = side === 'left' ? this.sides.right.path : this.sides.left.path;
		const picked = await pickVaultFile(this.app, `Choose file ${this.sideName(side)}`, other ? parentPath(other) : undefined);
		if (picked === null) return;
		const left = side === 'left' ? picked : this.sides.left.path;
		const right = side === 'right' ? picked : this.sides.right.path;
		await this.loadPair(left, right, true);
	}

	private async copyAll(direction: 'to-left' | 'to-right'): Promise<void> {
		const ok = await confirm(
			this.app,
			'Copy all changes',
			direction === 'to-right' ? 'Replace every change on B with the text from A?' : 'Replace every change on A with the text from B?',
		);
		if (!ok) return;
		this.surface?.copyAll(direction);
	}

	private openDisplayMenu(event: MouseEvent): void {
		const menu = new Menu();
		const items: Array<{ title: string; key: 'alignScroll' | 'showCurrentLine' | 'showLineNumbers' | 'showWhitespace' | 'wrapLines' | 'showIntraLine' | 'collapseUnchanged' }> = [
			{ title: 'Align scroll', key: 'alignScroll' },
			{ title: 'Show current line', key: 'showCurrentLine' },
			{ title: 'Show line numbers', key: 'showLineNumbers' },
			{ title: 'Show whitespace', key: 'showWhitespace' },
			{ title: 'Text wrapping', key: 'wrapLines' },
			{ title: 'Highlight changes inside a line', key: 'showIntraLine' },
			{ title: 'Collapse unchanged regions', key: 'collapseUnchanged' },
		];
		for (const item of items) {
			menu.addItem((entry) => {
				entry.setTitle(item.title).setChecked(this.plugin.settings[item.key]).onClick(() => {
					this.plugin.settings[item.key] = !this.plugin.settings[item.key];
					void this.plugin.saveSettings(false);
				});
			});
		}
		menu.showAtMouseEvent(event);
	}

	private applySettings(): void {
		this.syncAutosave();
		const originalOnA = this.plugin.settings.defaultLeftIsOriginal;
		const flipped = originalOnA !== this.originalOnA;
		this.originalOnA = originalOnA;

		const mobile = wantsMobileLayout(this.plugin.settings);
		const mobileChanged = mobile !== this.mobile;
		if (mobileChanged) {
			this.mobile = mobile;
			this.rebuildShell();
		}

		if (flipped && shouldFlipSides(originalOnA, this.originalPlacement(), this.hasFile())) {
			this.swap();
			return;
		}
		if (mobileChanged) return;

		this.renderSaveState();
		if (!this.surface) return;
		const options = this.surfaceOptions();
		if (options.scanLimit !== this.appliedScan) {
			this.mount();
			return;
		}
		this.surface.reconfigure(options);
		if (this.shell) this.refreshMobileBars();
	}

	private hasFile(): boolean {
		return this.sides.left.path !== null || this.sides.right.path !== null;
	}

	/** A is the left pane on desktop and the top pane on mobile. */
	private originalPlacement(): OriginalPlacement {
		const left = this.sides.left.path;
		const right = this.sides.right.path;
		if (!left || !right) return null;
		const index = this.plugin.index;
		if (index.isConflict(right) && index.originalFor(right) === left) return 'a';
		if (index.isConflict(left) && index.originalFor(left) === right) return 'b';
		return null;
	}

	private renderChrome(): void {
		this.renderLabel(this.leftLabel, this.sides.left);
		this.renderLabel(this.rightLabel, this.sides.right);
		this.renderBanners();
		this.renderSaveState();
		if (this.shell) this.refreshMobileBars();
	}

	private renderLabel(el: HTMLElement | null, state: SideState): void {
		if (!el) return;
		el.empty();
		if (!state.path) {
			el.createSpan({ cls: 'meld-picker-empty', text: NO_FILE_LABEL });
			el.removeAttribute('title');
			el.setAttribute('aria-label', NO_FILE_LABEL);
			return;
		}
		const { keep, tail } = fileBarLabel(state.path);
		const strut = el.createSpan({ cls: 'meld-picker-strut', text: keep });
		strut.setAttribute('aria-hidden', 'true');
		const line = el.createSpan({ cls: 'meld-picker-line' });
		line.createSpan({ cls: 'meld-picker-keep', text: keep });
		if (tail) line.createSpan({ cls: 'meld-picker-tail', text: tail });
		el.title = state.path;
		el.setAttribute('aria-label', state.path);
	}

	private renderBanners(): void {
		if (!this.bannerEl) return;
		this.bannerEl.empty();
		for (const side of ['left', 'right'] as const) {
			const state = this.sides[side];
			if (!state.path) continue;
			if (state.missing) this.banner(side, state.path === this.plugin.index.originalFor(this.otherPath(side) ?? '') ? 'Original file not found. Pick a file.' : 'File not found. Pick a file.', null);
			if (state.deleted) this.banner(side, 'File was deleted. Saving will recreate it.', null);
			if (state.disk) {
				this.banner(side, 'File changed on disk.', (row) => {
					const reload = row.createEl('button', { text: 'Reload' });
					const keep = row.createEl('button', { text: 'Keep editing' });
					reload.addEventListener('click', () => { void this.reloadSide(side); });
					keep.addEventListener('click', () => {
						state.disk = false;
						this.renderBanners();
					});
				});
			}
		}
	}

	private otherPath(side: Side): string | null {
		return this.sides[side === 'left' ? 'right' : 'left'].path;
	}

	private banner(side: Side, text: string, extra: ((row: HTMLElement) => void) | null): void {
		const row = this.bannerEl?.createDiv({ cls: 'meld-banner' });
		if (!row) return;
		row.createSpan({ text: `${this.sideName(side)}: ${text}` });
		extra?.(row);
	}

	private async reloadSide(side: Side): Promise<void> {
		const path = this.sides[side].path;
		if (!path) return;
		const next = await this.readSide(path);
		this.sides[side] = next;
		this.wasIdentical = this.sides.left.text === this.sides.right.text;
		this.mount();
	}

	private refreshTitle(): void {
		const leaf = this.leaf as LeafChrome;
		leaf.tabHeaderInnerTitleEl?.setText(this.getDisplayText());
		leaf.updateHeader?.();
		this.markTabUnsaved();
	}

	private syncAutosave(): void {
		if (!this.plugin.settings.autosave) {
			for (const side of ['left', 'right'] as const) {
				if (this.autoTimers[side]) window.clearTimeout(this.autoTimers[side]);
				this.autoTimers[side] = 0;
			}
			return;
		}
		this.scheduleAutosave('left');
		this.scheduleAutosave('right');
	}

	private renderSaveState(): void {
		this.paintBadge(this.leftBadge, 'A', this.linkedDirtyVisible('left'));
		this.paintBadge(this.rightBadge, 'B', this.linkedDirtyVisible('right'));
		this.shell?.setBadgeDirty('left', this.linkedDirtyVisible('left'));
		this.shell?.setBadgeDirty('right', this.linkedDirtyVisible('right'));
		this.updateToggles();
		this.markTabUnsaved();
	}

	private paintBadge(badge: HTMLElement | null, letter: 'A' | 'B', dirty: boolean): void {
		if (!badge) return;
		badge.toggleClass('is-dirty', dirty);
		if (dirty) badge.setAttribute('aria-label', `${letter} has unsaved edits`);
		else badge.removeAttribute('aria-label');
	}

	private markTabUnsaved(force?: boolean): void {
		const leaf = this.leaf as LeafChrome;
		const unsaved = force === false ? false : this.tabShowsUnsaved();
		leaf.tabHeaderEl?.toggleClass('mod-unsaved', unsaved);
	}

	/** Tab dot for a linked edit the user must save, or unbound text. A pending autosave stays quiet. */
	private tabShowsUnsaved(): boolean {
		for (const side of ['left', 'right'] as const) {
			if (!this.isDirty(side)) continue;
			if (!sideHasFile(this.sides[side])) return true;
			if (this.linkedDirtyVisible(side)) return true;
		}
		return false;
	}

	private updateToggles(): void {
		const manualSave = !this.plugin.settings.autosave;
		this.syncSaveButton(this.leftSave, 'left', manualSave);
		this.syncSaveButton(this.rightSave, 'right', manualSave);
	}

	private syncSaveButton(button: HTMLButtonElement | null, side: Side, manualSave: boolean): void {
		if (!button) return;
		button.toggleClass('meld-save-hidden', !manualSave);
		const enabled = this.canSaveSide(side);
		button.disabled = !enabled;
		const label = enabled ? `Save file ${this.sideName(side)}` : saveDisabledReason(this.sides[side]);
		button.setAttribute('aria-label', label);
		button.title = label;
	}

	private fileButton(parent: HTMLElement, side: Side): HTMLElement {
		const button = parent.createEl('button', { cls: 'meld-file-button' });
		button.addEventListener('click', () => { void this.pick(side); });
		return button;
	}

	private sideBadge(parent: HTMLElement, letter: 'A' | 'B'): HTMLElement {
		return parent.createSpan({ cls: `meld-side-badge is-${letter === 'A' ? 'a' : 'b'}`, text: letter });
	}

	private moreButton(parent: HTMLElement, side: Side): void {
		const button = parent.createEl('button', { cls: 'clickable-icon meld-more', attr: { 'aria-label': `${this.sideName(side)} file actions` } });
		setIcon(button, 'more-vertical');
		button.addEventListener('click', (event) => {
			const path = this.sides[side].path;
			const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
			const menu = new Menu();
			this.addSaveItem(menu, side);
			menu.addSeparator();
			populateFileMenu(menu, this.app, file instanceof TFile ? file : null);
			menu.showAtMouseEvent(event);
		});
	}

	private iconButton(parent: HTMLElement, icon: string, label: string, action: () => void): HTMLButtonElement {
		const button = parent.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': label } });
		button.title = label;
		setIcon(button, icon);
		button.addEventListener('click', (event) => {
			event.preventDefault();
			action();
		});
		return button;
	}

	private textButton(parent: HTMLElement, text: string, label: string, action: (event: MouseEvent) => void): HTMLButtonElement {
		const button = parent.createEl('button', { cls: 'meld-text-button', text, attr: { 'aria-label': label } });
		button.title = label;
		button.addEventListener('click', (event) => {
			event.preventDefault();
			action(event);
		});
		return button;
	}

	private addSaveItem(menu: Menu, side: Side): void {
		const state = this.sides[side];
		menu.addItem((item) => {
			item.setIcon('save');
			if (!this.canSaveSide(side)) {
				item.setTitle(disabledSaveTitle(saveDisabledReason(state))).setDisabled(true);
				return;
			}
			item.setTitle('Save').onClick(() => { void this.save(side); });
		});
		menu.addItem((item) => {
			item.setIcon('file-plus');
			if (state.binary || state.tooBig) {
				item.setTitle('Save as…').setDisabled(true);
				return;
			}
			item.setTitle('Save as…').onClick(() => { void this.saveAs(side); });
		});
	}

	private addSideSubmenu(menu: Menu, title: string, side: Side): void {
		menu.addItem((item) => {
			item.setTitle(title).setIcon('file');
			const anyItem = item as { setSubmenu?: () => Menu };
			const path = this.sides[side].path;
			const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
			const target = file instanceof TFile ? file : null;
			if (typeof anyItem.setSubmenu === 'function') {
				const sub = anyItem.setSubmenu();
				this.addSaveItem(sub, side);
				sub.addSeparator();
				populateFileMenu(sub, this.app, target);
				return;
			}
			item.onClick((event) => {
				if (!(event instanceof MouseEvent)) return;
				const menu = new Menu();
				this.addSaveItem(menu, side);
				menu.addSeparator();
				populateFileMenu(menu, this.app, target);
				menu.showAtMouseEvent(event);
			});
		});
	}

	private installCloseGuard(): void {
		const leaf = this.leaf as LeafChrome;
		const original = leaf.detach.bind(leaf);
		this.originalDetach = original;
		leaf.detach = () => {
			void this.onDetachRequested();
		};
	}

	private async onDetachRequested(): Promise<void> {
		if (this.closing || this.detachQueued) return;
		this.detachQueued = true;
		let proceed = false;
		try {
			if (this.plugin.settings.autosave) await this.flushLinked();
			if (this.hasUnsaved()) {
				const ok = await this.resolveUnsaved();
				if (!ok || this.closing) return;
			}
			proceed = true;
		} catch (error) {
			console.error(error);
		} finally {
			if (!proceed) this.detachQueued = false;
		}
		if (!proceed || this.closing) return;
		this.closing = true;
		this.restoreDetach();
		this.originalDetach?.();
	}

	private restoreDetach(): void {
		const leaf = this.leaf as LeafChrome;
		if (!this.originalDetach) return;
		leaf.detach = this.originalDetach;
	}
}

function disabledSaveTitle(reason: string): DocumentFragment {
	return createFragment((frag) => {
		frag.createSpan({ text: 'Save' });
		frag.createSpan({ cls: 'meld-menu-caption', text: reason });
	});
}

