import { Notice, Platform, Plugin, TFile, setIcon, type WorkspaceLeaf } from 'obsidian';
import { registerCommands } from './commands';
import { CONFLICT_VIEW_TYPE, DIFF_VIEW_TYPE } from './constants';
import {
	adoptHunkColorDeclarations,
	meldColorDeclarations,
	removeHunkColorStyle,
	sameDeclarations,
	writeHunkColorStyle,
} from './diff/hunk-colors';
import { ConflictIndex } from './index/conflict-index';
import { registerMenus } from './menus';
import { pickConflictFile, pickVaultFile } from './diff/file-suggest';
import { mergeSettings } from './settings';
import { MeldDiffSettingTab } from './settings-tab';
import type { MeldDiffSettings } from './types';
import { ConflictStatusBar } from './ui/status-bar';
import { ConflictView } from './views/conflict-view';
import { DiffView } from './views/diff-view';
import { collectLeaves, noteActivation, openMeldView, type Placement } from './workspace';

export interface OpenPathOptions {
	placement: Placement;
	preferCenter?: boolean;
	prompt?: boolean;
}

export default class MeldDiffPlugin extends Plugin {
	settings: MeldDiffSettings = mergeSettings(null);
	index!: ConflictIndex;
	private readonly settingsListeners = new Set<() => void>();
	private status: ConflictStatusBar | null = null;
	private conflictRibbon: HTMLElement | null = null;
	private diffRibbon: HTMLElement | null = null;
	private nextCursor: string | null = null;
	private styleSettingsBaselined = false;
	private styleSettingsColors = new Map<string, string>();

	async onload(): Promise<void> {
		this.settings = mergeSettings(await this.loadData());
		this.index = new ConflictIndex(this.app, () => this.settings);
		this.register(this.index.subscribe(() => this.refreshStatus()));
		this.registerView(CONFLICT_VIEW_TYPE, (leaf) => new ConflictView(leaf, this));
		this.registerView(DIFF_VIEW_TYPE, (leaf) => new DiffView(leaf, this));
		this.addSettingTab(new MeldDiffSettingTab(this.app, this));
		registerCommands(this);
		registerMenus(this);
		if (!Platform.isMobile) {
			this.mountRibbon();
			this.status = new ConflictStatusBar(() => this.addStatusBarItem(), () => { void this.openView('conflict', 'reveal'); });
		}
		this.refreshStatus();
		this.noteStyleSettingsColors();
		this.pushHunkColors();
		this.app.workspace.trigger('parse-style-settings');
		this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => noteActivation(leaf)));
		this.registerEvent(this.app.workspace.on('window-open', (_workspace, win) => {
			writeHunkColorStyle(win.document, this.settings);
		}));
		this.registerEvent(this.app.workspace.on('css-change', (data?: { source?: string }) => {
			if (data?.source === 'style-settings') {
				this.adoptStyleSettingsColors();
				return;
			}
			for (const view of this.diffViews()) view.onCssChange();
		}));
		this.registerEvent(this.app.vault.on('create', () => this.index.queue(true)));
		this.registerEvent(this.app.vault.on('delete', (file) => {
			this.index.queue(true);
			for (const view of this.diffViews()) view.handleDelete(file.path);
		}));
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
			this.index.queue(true);
			for (const view of this.diffViews()) view.handleRename(oldPath, file.path);
		}));
		this.registerEvent(this.app.vault.on('modify', (file) => {
			this.index.queue(false);
			if (file instanceof TFile) {
				for (const view of this.diffViews()) void view.handleModify(file);
			}
		}));
		if (this.settings.scanOnStartup) this.index.queue(true);
		this.registerEvent(this.app.workspace.on('quit', (tasks) => {
			tasks.add(() => this.prepareQuit());
		}));
	}

	/**
	 * Quit task. Autosave writes linked dirty sides first. Anything still unsaved
	 * (a note with autosave off, a failed write, or text that is not a note) is confirmed.
	 * If a dialog cannot be shown, linked sides are still written and unbound text is not discarded.
	 */
	private async prepareQuit(): Promise<void> {
		const views = this.diffViews();
		if (this.settings.autosave) {
			for (const view of views) await view.flushLinked();
		}
		if (!views.some((view) => view.hasUnsaved())) return;
		if (!this.canPrompt()) {
			for (const view of views) await view.flushLinked();
			if (views.some((view) => view.hasUnboundText())) {
				throw new Error('Meld Diff: unsaved text is not in a note');
			}
			return;
		}
		for (const view of views) {
			if (!view.hasUnsaved()) continue;
			let ok = false;
			try {
				ok = await view.resolveUnsaved();
			} catch (error) {
				console.error(error);
				for (const open of views) await open.flushLinked();
				if (views.some((open) => open.hasUnboundText())) {
					throw new Error('Meld Diff: unsaved text is not in a note');
				}
				return;
			}
			if (!ok) throw new Error('Meld Diff: quit cancelled');
		}
	}

	private canPrompt(): boolean {
		try {
			return !!this.app.workspace.containerEl?.isConnected;
		} catch {
			return false;
		}
	}

	onunload(): void {
		this.index?.dispose();
		this.status?.unload();
		for (const doc of this.colorDocuments()) removeHunkColorStyle(doc);
	}

	onSettings(listener: () => void): () => void {
		this.settingsListeners.add(listener);
		return () => this.settingsListeners.delete(listener);
	}

	async saveSettings(rescanExtras = false, applyColors = false): Promise<void> {
		await this.saveData(this.settings);
		if (applyColors) this.pushHunkColors();
		this.syncRibbon();
		this.refreshStatus();
		this.index.queue(rescanExtras);
		for (const listener of [...this.settingsListeners]) listener();
	}

	rescan(): void {
		this.index.queue(true);
	}

	openSettings(): void {
		const setting = (this.app as { setting?: { open: () => void; openTabById: (id: string) => void } }).setting;
		if (!setting) {
			new Notice('Open Settings → Community plugins → Meld Diff.');
			return;
		}
		setting.open();
		setting.openTabById(this.manifest.id);
	}

	markCursor(path: string): void {
		this.nextCursor = path;
	}

	getActiveDiffView(): DiffView | null {
		const active = this.app.workspace.activeLeaf;
		if (active?.view instanceof DiffView) return active.view;
		for (const leaf of collectLeaves(this.app, DIFF_VIEW_TYPE)) {
			if (!(leaf.view instanceof DiffView)) continue;
			const doc = leaf.view.containerEl.ownerDocument;
			if (doc.hasFocus() && leaf.view.containerEl.contains(doc.activeElement)) return leaf.view;
		}
		return null;
	}

	async openView(kind: 'conflict' | 'diff', placement: Placement): Promise<void> {
		const phone = Platform.isMobile;
		const opened = kind === 'diff'
			? await this.openDiffLeaf({
				placement,
				preferCenter: false,
				state: placement === 'tab' ? { leftPath: null, rightPath: null } : undefined,
			})
			: await openMeldView({
				app: this.app,
				viewType: CONFLICT_VIEW_TYPE,
				placement,
				preferCenter: false,
				mobileConflict: phone,
			});
		if (!opened && placement !== 'toggle') new Notice(`Could not open the ${kind} view.`);
	}

	async openPair(original: string, conflict: string, newTab: boolean): Promise<void> {
		const left = this.settings.defaultLeftIsOriginal ? original : conflict;
		const right = this.settings.defaultLeftIsOriginal ? conflict : original;
		await this.openPaths(left, right, {
			placement: newTab ? 'tab' : 'reveal',
			preferCenter: !newTab,
			prompt: true,
		});
	}

	async openPaths(left: string | null, right: string | null, options: OpenPathOptions): Promise<void> {
		const opened = await this.openDiffLeaf({
			placement: options.placement,
			preferCenter: options.preferCenter ?? false,
			state: { leftPath: left, rightPath: right },
		});
		if (!opened) {
			new Notice('Could not open Diff View.');
			return;
		}
		if (!opened.created) {
			await this.whenDiff(opened.leaf, async (view) => {
				await view.loadPair(left, right, options.prompt !== false);
			});
		}
		await this.app.workspace.revealLeaf(opened.leaf);
	}

	async setSide(side: 'left' | 'right', path: string): Promise<void> {
		const opened = await this.openDiffLeaf({
			placement: 'reveal',
			preferCenter: true,
			state: side === 'left' ? { leftPath: path, rightPath: null } : { leftPath: null, rightPath: path },
		});
		if (!opened) return;
		if (!opened.created) {
			await this.whenDiff(opened.leaf, async (view) => {
				const state = view.getState();
				const left = typeof state.leftPath === 'string' ? state.leftPath : null;
				const right = typeof state.rightPath === 'string' ? state.rightPath : null;
				await view.loadPair(side === 'left' ? path : left, side === 'right' ? path : right, true);
			});
		}
		await this.app.workspace.revealLeaf(opened.leaf);
	}

	async compareTwoFiles(): Promise<void> {
		const left = await pickVaultFile(this.app, 'Choose file A');
		if (!left) return;
		const right = await pickVaultFile(this.app, 'Choose file B', left.includes('/') ? left.slice(0, left.lastIndexOf('/')) : '/');
		if (!right) return;
		await this.openPaths(left, right, { placement: 'tab', prompt: false });
	}

	async compareActiveWithConflict(file: TFile): Promise<void> {
		if (this.index.isConflict(file.path)) {
			const original = this.index.originalFor(file.path);
			if (!original) {
				new Notice('Could not recover the original path.');
				return;
			}
			await this.openPair(original, file.path, false);
			return;
		}
		const conflicts = this.index.conflictsFor(file.path);
		const only = conflicts[0];
		if (!only) {
			new Notice('This file has no conflict copies.');
			return;
		}
		const picked = conflicts.length === 1 ? only : await pickConflictFile(this.app, conflicts);
		if (!picked) return;
		await this.openPair(file.path, picked.path, false);
	}

	async openNextConflict(): Promise<void> {
		const flat = this.index.flat();
		if (flat.length === 0) {
			new Notice('No conflict files.');
			return;
		}
		let index = 0;
		if (this.nextCursor) {
			const current = flat.findIndex((item) => item.conflict.path === this.nextCursor);
			index = current >= 0 ? current + 1 : 0;
		}
		const item = flat[index];
		if (!item) {
			new Notice('No further conflicts.');
			return;
		}
		this.nextCursor = item.conflict.path;
		await this.openPair(item.group.originalPath, item.conflict.path, false);
	}

	private async openDiffLeaf(options: { placement: Placement; preferCenter?: boolean; state?: Record<string, unknown> }): Promise<Awaited<ReturnType<typeof openMeldView>>> {
		const phone = Platform.isMobile;
		let placement = options.placement;
		if (phone && (placement === 'left' || placement === 'right')) placement = 'tab';
		return openMeldView({
			app: this.app,
			viewType: DIFF_VIEW_TYPE,
			placement,
			preferCenter: phone || (options.preferCenter ?? false),
			centerOnly: phone,
			state: options.state,
		});
	}

	private async whenDiff(leaf: WorkspaceLeaf, run: (view: DiffView) => Promise<void>): Promise<void> {
		const deferred = leaf as WorkspaceLeaf & { loadIfDeferred?: () => Promise<void> };
		if (leaf.isDeferred && deferred.loadIfDeferred) await deferred.loadIfDeferred();
		if (leaf.view instanceof DiffView) await run(leaf.view);
	}

	private diffViews(): DiffView[] {
		return collectLeaves(this.app, DIFF_VIEW_TYPE)
			.map((leaf) => leaf.view)
			.filter((view): view is DiffView => view instanceof DiffView);
	}

	private mountRibbon(): void {
		this.conflictRibbon = this.addRibbonIcon('alert-triangle', 'Meld Diff: Conflicts', () => {
			void this.openView('conflict', 'reveal');
		});
		this.diffRibbon = this.addRibbonIcon('git-compare', 'Meld Diff: Diff', () => {
			void this.openView('diff', 'reveal');
		});
		setIcon(this.conflictRibbon, 'alert-triangle');
		this.syncRibbon();
	}

	private syncRibbon(): void {
		const enabled = this.settings.ribbonEnabled;
		this.conflictRibbon?.toggleClass('meld-ribbon-hidden', !(enabled && this.settings.ribbonConflicts));
		this.diffRibbon?.toggleClass('meld-ribbon-hidden', !(enabled && this.settings.ribbonDiff));
	}

	private refreshStatus(): void {
		this.status?.refresh(this.settings.statusBarEnabled, this.index.ready, this.index.conflictCount());
	}

	private colorDocuments(): Document[] {
		const docs = new Set<Document>([document]);
		this.app.workspace.iterateAllLeaves((leaf) => {
			const owner = leaf.view?.containerEl?.ownerDocument;
			if (owner) docs.add(owner);
		});
		return [...docs];
	}

	private pushHunkColors(): void {
		for (const doc of this.colorDocuments()) writeHunkColorStyle(doc, this.settings);
		this.noteStyleSettingsColors();
	}

	private noteStyleSettingsColors(): void {
		const tag = document.getElementById('css-settings-manager');
		this.styleSettingsBaselined = tag !== null;
		this.styleSettingsColors = meldColorDeclarations(tag?.textContent ?? '');
	}

	private adoptStyleSettingsColors(): void {
		const tag = document.getElementById('css-settings-manager');
		const next = meldColorDeclarations(tag?.textContent ?? '');
		if (!this.styleSettingsBaselined) {
			this.styleSettingsBaselined = true;
			this.styleSettingsColors = next;
			return;
		}
		if (sameDeclarations(this.styleSettingsColors, next)) {
			this.styleSettingsColors = next;
			return;
		}
		const changed = adoptHunkColorDeclarations(this.settings, this.styleSettingsColors, next);
		this.styleSettingsColors = next;
		if (!changed) return;
		void this.saveSettings(false, true);
	}
}
