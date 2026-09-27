import { ItemView, Menu, Notice, Scope, TFile, setIcon, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import { DIFF_VIEW_TYPE, HARD_FILE_BYTES, WARN_FILE_BYTES } from '../constants';
import { populateFileMenu, showFileMenu } from '../diff/file-actions';
import { pickVaultFile } from '../diff/file-suggest';
import type { HunkAction } from '../diff/hunk-actions';
import { DiffSurface, type SurfaceOptions, type SurfacePane } from '../diff/merge-host';
import type MeldDiffPlugin from '../main';
import { fileName, formatBytes, isBinaryExtension, parentPath } from '../text-util';
import { askDirty, confirm, noticeError } from '../ui/confirm';
import type { DiffViewState } from '../types';

type Side = 'left' | 'right';

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
	private readonly modifyToken: Record<Side, number> = { left: 0, right: 0 };
	private wasIdentical = false;
	private prompting = false;
	private appliedScan = 0;
	private surface: DiffSurface | null = null;
	private countEl: HTMLElement | null = null;
	private bannerEl: HTMLElement | null = null;
	private leftLabel: HTMLElement | null = null;
	private rightLabel: HTMLElement | null = null;
	private leftSave: HTMLButtonElement | null = null;
	private rightSave: HTMLButtonElement | null = null;
	private readonly warned = new Set<string>();
	private readonly autoTimers: Record<Side, number> = { left: 0, right: 0 };

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
		const left = fileName(this.sides.left.path);
		const right = fileName(this.sides.right.path);
		if (!left && !right) return 'Diff';
		return `${left || 'Empty'} ↔ ${right || 'Empty'}`;
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
		this.contentEl.empty();
		this.contentEl.addClass('meld-diff-view');
		const header = this.contentEl.createDiv({ cls: 'meld-diff-header' });
		const files = header.createDiv({ cls: 'meld-diff-files' });
		this.leftSave = this.iconButton(files, 'save', 'Save left file', () => { void this.save('left'); });
		files.createSpan({ cls: 'meld-side-label', text: 'Left' });
		this.leftLabel = this.fileButton(files, 'left');
		this.moreButton(files, 'left');
		this.iconButton(files, 'arrow-left-right', 'Swap left and right', () => this.swap());
		this.rightSave = this.iconButton(files, 'save', 'Save right file', () => { void this.save('right'); });
		files.createSpan({ cls: 'meld-side-label', text: 'Right' });
		this.rightLabel = this.fileButton(files, 'right');
		this.moreButton(files, 'right');
		const tools = header.createDiv({ cls: 'meld-diff-tools' });
		this.countEl = tools.createSpan({ cls: 'meld-change-count', text: 'Changes: 0' });
		this.textButton(tools, 'Prev', 'Previous change', () => this.prevHunk());
		this.textButton(tools, 'Next', 'Next change', () => this.nextHunk());
		this.textButton(tools, 'Display', 'Display options', (event) => this.openDisplayMenu(event));
		this.textButton(tools, 'To right', 'Copy all changes left to right', () => { void this.copyAll('to-right'); });
		this.textButton(tools, 'To left', 'Copy all changes right to left', () => { void this.copyAll('to-left'); });
		this.bannerEl = this.contentEl.createDiv({ cls: 'meld-banners' });
		const body = this.contentEl.createDiv({ cls: 'meld-diff-body' });
		this.surface = new DiffSurface(body, {
			onDoc: (side, text) => this.onDoc(side, text),
			onFocus: (side) => { this.focused = side; },
			onSave: (which) => {
				if (which === 'both') void this.saveBoth();
				else void this.save(which);
			},
			onChunks: (count) => this.countEl?.setText(`Changes: ${count}`),
		});
		this.register(this.plugin.onSettings(() => this.applySettings()));
		this.opened = true;
		this.updateToggles();
		await this.loadPair(this.sides.left.path, this.sides.right.path, false);
	}

	async onClose(): Promise<void> {
		this.opened = false;
		for (const side of ['left', 'right'] as const) {
			if (this.autoTimers[side]) window.clearTimeout(this.autoTimers[side]);
		}
		this.surface?.destroy();
		this.surface = null;
		this.contentEl.empty();
	}

	onPaneMenu(menu: Menu, source: string): void {
		super.onPaneMenu(menu, source);
		menu.addSeparator();
		this.addSideSubmenu(menu, 'Left file', 'left');
		this.addSideSubmenu(menu, 'Right file', 'right');
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
		const left = { ...this.sides.left };
		const right = { ...this.sides.right };
		this.sides.left = right;
		this.sides.right = left;
		this.loadedKey = `${this.sides.left.path ?? ''}\n${this.sides.right.path ?? ''}`;
		this.mount();
		this.renderChrome();
		this.refreshTitle();
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
		await this.save(this.focused);
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
		if (key === this.loadedKey) return;
		if (prompt && left !== this.sides.left.path && !(await this.confirmReplace('left'))) return;
		if (prompt && right !== this.sides.right.path && !(await this.confirmReplace('right'))) return;
		const token = ++this.loadToken;
		this.loading = true;
		const nextLeft = await this.readSide(left);
		if (token !== this.loadToken) return;
		const nextRight = await this.readSide(right);
		if (token !== this.loadToken) return;
		this.sides.left = nextLeft;
		this.sides.right = nextRight;
		this.wasIdentical = nextLeft.text === nextRight.text;
		this.loadedKey = key;
		this.loading = false;
		this.mount();
		this.renderChrome();
		this.refreshTitle();
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

	private async confirmReplace(side: Side): Promise<boolean> {
		if (!this.isDirty(side)) return true;
		const choice = await askDirty(this.app, side === 'left' ? 'Left file' : 'Right file');
		if (choice === 'cancel') return false;
		if (choice === 'discard') return true;
		return this.save(side);
	}

	private isDirty(side: Side): boolean {
		const state = this.sides[side];
		return !!state.path && !state.binary && !state.tooBig && state.text !== state.saved;
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
		const options = this.surfaceOptions();
		this.appliedScan = options.scanLimit;
		this.surface.set(this.toPane('left'), this.toPane('right'), options);
		this.renderBanners();
	}

	private toPane(side: Side): SurfacePane {
		const state = this.sides[side];
		if (!state.path) return { text: '', path: null, readOnly: true, placeholder: 'Select a file', detail: '' };
		if (state.binary) return { text: '', path: state.path, readOnly: true, placeholder: 'Cannot text-diff this file.', detail: `${fileName(state.path)} · ${formatBytes(state.size)}` };
		if (state.tooBig) return { text: '', path: state.path, readOnly: true, placeholder: 'This file is too large to text-diff.', detail: `${fileName(state.path)} · ${formatBytes(state.size)}` };
		return { text: state.text, path: state.path, readOnly: state.deleted, placeholder: null, detail: '' };
	}

	private onDoc(side: Side, text: string): void {
		if (this.loading) return;
		this.sides[side].text = text;
		this.scheduleAutosave(side);
		this.maybePromptIdentical();
	}

	private scheduleAutosave(side: Side): void {
		if (this.autoTimers[side]) window.clearTimeout(this.autoTimers[side]);
		this.autoTimers[side] = 0;
		if (!this.plugin.settings.autosave || !this.isDirty(side)) return;
		const file = this.sides[side].path ? this.app.vault.getAbstractFileByPath(this.sides[side].path as string) : null;
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
		if (!state.path) {
			new Notice('Choose a file before saving.');
			return false;
		}
		if (state.binary || state.tooBig) {
			new Notice('This side is not a text file.');
			return false;
		}
		const text = this.surface?.getText(side) ?? state.text;
		state.text = text;
		try {
			const existing = this.app.vault.getAbstractFileByPath(state.path);
			if (existing instanceof TFile) await this.app.vault.modify(existing, text);
			else if (existing) {
				new Notice('That path is a folder.');
				return false;
			} else await this.app.vault.create(state.path, text);
			state.saved = text;
			state.deleted = false;
			state.missing = false;
			state.disk = false;
			this.renderBanners();
			return true;
		} catch (error) {
			noticeError(error, 'Could not save the file');
			return false;
		}
	}

	private async pick(side: Side): Promise<void> {
		const other = side === 'left' ? this.sides.right.path : this.sides.left.path;
		const picked = await pickVaultFile(this.app, side === 'left' ? 'Choose the left file' : 'Choose the right file', other ? parentPath(other) : undefined);
		if (picked === null) return;
		const left = side === 'left' ? picked : this.sides.left.path;
		const right = side === 'right' ? picked : this.sides.right.path;
		await this.loadPair(left, right, true);
	}

	private async copyAll(direction: 'to-left' | 'to-right'): Promise<void> {
		const ok = await confirm(
			this.app,
			'Copy all changes',
			direction === 'to-right' ? 'Replace every right-hand change with the left-hand text?' : 'Replace every left-hand change with the right-hand text?',
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
		this.updateToggles();
		if (!this.surface) return;
		const options = this.surfaceOptions();
		if (options.scanLimit !== this.appliedScan) {
			this.mount();
			return;
		}
		this.surface.reconfigure(options);
	}

	private renderChrome(): void {
		this.renderLabel(this.leftLabel, this.sides.left);
		this.renderLabel(this.rightLabel, this.sides.right);
		this.renderBanners();
		this.updateToggles();
	}

	private renderLabel(el: HTMLElement | null, state: SideState): void {
		if (!el) return;
		el.empty();
		if (!state.path) {
			el.createSpan({ cls: 'meld-picker-empty', text: 'Select a file' });
			return;
		}
		el.createSpan({ cls: 'meld-picker-name', text: fileName(state.path) });
		const parent = parentPath(state.path);
		if (parent) el.createSpan({ cls: 'meld-picker-parent', text: parent });
		el.title = state.path;
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
		row.createSpan({ text: `${side === 'left' ? 'Left' : 'Right'}: ${text}` });
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
		const leaf = this.leaf as WorkspaceLeaf & { updateHeader?: () => void; tabHeaderInnerTitleEl?: HTMLElement };
		leaf.tabHeaderInnerTitleEl?.setText(this.getDisplayText());
		leaf.updateHeader?.();
	}

	private updateToggles(): void {
		const manualSave = !this.plugin.settings.autosave;
		this.leftSave?.toggleClass('meld-save-hidden', !manualSave);
		this.rightSave?.toggleClass('meld-save-hidden', !manualSave);
	}

	private fileButton(parent: HTMLElement, side: Side): HTMLElement {
		const button = parent.createEl('button', { cls: 'meld-file-button' });
		button.addEventListener('click', () => { void this.pick(side); });
		return button;
	}

	private moreButton(parent: HTMLElement, side: Side): void {
		const button = parent.createEl('button', { cls: 'clickable-icon meld-more', attr: { 'aria-label': `${side} file actions` } });
		setIcon(button, 'more-vertical');
		button.addEventListener('click', (event) => {
			const path = this.sides[side].path;
			const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
			showFileMenu(this.app, file instanceof TFile ? file : null, event);
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

	private addSideSubmenu(menu: Menu, title: string, side: Side): void {
		menu.addItem((item) => {
			item.setTitle(title).setIcon('file');
			const anyItem = item as { setSubmenu?: () => Menu };
			const path = this.sides[side].path;
			const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
			const target = file instanceof TFile ? file : null;
			if (typeof anyItem.setSubmenu === 'function') {
				populateFileMenu(anyItem.setSubmenu(), this.app, target);
				return;
			}
			item.onClick((event) => {
				if (event instanceof MouseEvent) showFileMenu(this.app, target, event);
			});
		});
	}
}

