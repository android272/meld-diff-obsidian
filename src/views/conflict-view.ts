import { ItemView, Menu, Notice, TFile, setIcon, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import { keepConflict, keepOriginal, trashConflictGroup } from '../conflict-actions';
import { CONFLICT_VIEW_TYPE } from '../constants';
import { openInNewTab, revealInNavigation, showInSystem } from '../diff/file-actions';
import { patternHealth } from '../patterns';
import type MeldDiffPlugin from '../main';
import { fileName, formatBytes, formatStamp, parentPath } from '../text-util';
import type { ConflictFile, ConflictGroup, ConflictViewState } from '../types';

export class ConflictView extends ItemView {
	private readonly collapsedFolders = new Set<string>();
	private readonly collapsedOriginals = new Set<string>();
	private query = '';
	private pendingScroll = 0;
	private listEl: HTMLElement | null = null;
	private metaEl: HTMLElement | null = null;
	private filterEl: HTMLInputElement | null = null;
	private opened = false;

	constructor(leaf: WorkspaceLeaf, private readonly plugin: MeldDiffPlugin) {
		super(leaf);
		this.navigation = true;
	}

	getViewType(): string {
		return CONFLICT_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Conflicts';
	}

	getIcon(): string {
		return 'alert-triangle';
	}

	getState(): Record<string, unknown> {
		return {
			collapsedFolders: [...this.collapsedFolders],
			collapsedOriginals: [...this.collapsedOriginals],
			query: this.query,
			scrollTop: this.listEl?.scrollTop ?? this.pendingScroll,
		};
	}

	async setState(state: unknown, _result: ViewStateResult): Promise<void> {
		const raw = (state ?? {}) as ConflictViewState;
		this.collapsedFolders.clear();
		this.collapsedOriginals.clear();
		for (const folder of raw.collapsedFolders ?? []) this.collapsedFolders.add(folder);
		for (const original of raw.collapsedOriginals ?? []) this.collapsedOriginals.add(original);
		this.query = raw.query ?? '';
		this.pendingScroll = raw.scrollTop ?? 0;
		if (this.filterEl) this.filterEl.value = this.query;
		if (this.opened) this.renderList();
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('meld-conflict-view');
		const header = this.contentEl.createDiv({ cls: 'meld-conflict-header' });
		header.createDiv({ cls: 'meld-conflict-title', text: 'Conflicts' });
		const tools = header.createDiv({ cls: 'meld-conflict-tools' });
		this.iconButton(tools, 'refresh-cw', 'Rescan', () => this.plugin.rescan());
		this.iconButton(tools, 'settings', 'Meld Diff settings', () => this.plugin.openSettings());
		this.filterEl = this.contentEl.createEl('input', {
			cls: 'meld-input',
			type: 'search',
			placeholder: 'Filter files…',
			value: this.query,
		});
		this.filterEl.addEventListener('input', () => {
			this.query = this.filterEl?.value ?? '';
			this.renderList();
		});
		this.metaEl = this.contentEl.createDiv({ cls: 'meld-conflict-meta' });
		this.listEl = this.contentEl.createDiv({ cls: 'meld-conflict-list' });
		this.register(this.plugin.index.subscribe(() => this.renderList()));
		this.opened = true;
		if (!this.plugin.index.ready) this.plugin.rescan();
		this.renderList();
	}

	async onClose(): Promise<void> {
		this.opened = false;
		this.contentEl.empty();
	}

	private iconButton(parent: HTMLElement, icon: string, label: string, action: () => void): void {
		const button = parent.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': label } });
		button.title = label;
		setIcon(button, icon);
		button.addEventListener('click', (event) => {
			event.preventDefault();
			action();
		});
	}

	private renderList(): void {
		if (!this.listEl || !this.metaEl) return;
		const scroll = this.listEl.scrollTop;
		const index = this.plugin.index;
		const groups = index.listGroups();
		const health = patternHealth(this.plugin.settings.patterns);
		const query = this.query.trim().toLowerCase();
		const filtered = groups
			.map((group) => ({
				group,
				conflicts: group.conflicts.filter((conflict) => this.matches(group, conflict, query)),
			}))
			.filter((item) => item.conflicts.length > 0);
		const originals = filtered.length;
		const conflicts = filtered.reduce((sum, item) => sum + item.conflicts.length, 0);
		this.metaEl.setText(index.scanning && !index.ready ? 'Scanning…' : `${originals} original${originals === 1 ? '' : 's'} · ${conflicts} conflict file${conflicts === 1 ? '' : 's'}`);
		this.listEl.empty();
		if (!index.ready && index.scanning) {
			this.listEl.createDiv({ cls: 'meld-empty', text: 'Scanning…' });
			return;
		}
		if (health.enabled === 0 || (health.enabled > 0 && health.valid === 0)) {
			const empty = this.listEl.createDiv({ cls: 'meld-empty' });
			empty.createDiv({ text: health.enabled === 0 ? 'No conflict patterns are enabled.' : 'All patterns are invalid.' });
			const link = empty.createEl('a', { text: 'Open settings', href: '#' });
			link.addEventListener('click', (event) => {
				event.preventDefault();
				this.plugin.openSettings();
			});
			return;
		}
		if (filtered.length === 0) {
			this.listEl.createDiv({
				cls: 'meld-empty',
				text: query ? 'No conflicts match the filter.' : 'No conflict files match the current patterns.',
			});
			return;
		}
		const folders = new Map<string, typeof filtered>();
		for (const item of filtered) {
			const folder = parentPath(item.group.originalPath);
			const list = folders.get(folder) ?? [];
			list.push(item);
			folders.set(folder, list);
		}
		for (const folder of [...folders.keys()].sort((a, b) => a.localeCompare(b))) {
			const items = folders.get(folder) ?? [];
			this.renderFolder(folder, items);
		}
		this.listEl.scrollTop = this.pendingScroll || scroll;
		this.pendingScroll = 0;
	}

	private matches(group: ConflictGroup, conflict: ConflictFile, query: string): boolean {
		if (!query) return true;
		const haystack = [group.originalPath, conflict.path, conflict.modifiedBy, conflict.date, conflict.time].filter(Boolean).join(' ').toLowerCase();
		return haystack.includes(query);
	}

	private renderFolder(folder: string, items: Array<{ group: ConflictGroup; conflicts: ConflictFile[] }>): void {
		if (!this.listEl) return;
		const collapsed = this.collapsedFolders.has(folder);
		const header = this.listEl.createDiv({ cls: 'meld-folder' });
		const twist = header.createSpan({ cls: 'meld-twist', text: collapsed ? '▸' : '▾' });
		header.createSpan({ text: folder || 'Vault root' });
		const count = items.reduce((sum, item) => sum + item.conflicts.length, 0);
		header.createSpan({ cls: 'meld-count', text: String(count) });
		header.addEventListener('click', () => {
			if (collapsed) this.collapsedFolders.delete(folder);
			else this.collapsedFolders.add(folder);
			this.renderList();
		});
		void twist;
		if (collapsed) return;
		for (const item of items) this.renderOriginal(item.group, item.conflicts);
	}

	private renderOriginal(group: ConflictGroup, conflicts: ConflictFile[]): void {
		if (!this.listEl) return;
		const collapsed = this.collapsedOriginals.has(group.originalPath);
		const row = this.listEl.createDiv({ cls: 'meld-original' });
		row.createSpan({ cls: 'meld-twist', text: collapsed ? '▸' : '▾' });
		const name = row.createSpan({ cls: 'meld-name', text: fileName(group.originalPath) });
		name.title = group.originalPath;
		if (!group.originalExists) {
			const warn = row.createSpan({ cls: 'meld-missing', text: 'missing' });
			warn.title = 'Original file not found';
		}
		row.createSpan({ cls: 'meld-count', text: `${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'}` });
		row.addEventListener('click', () => {
			if (collapsed) this.collapsedOriginals.delete(group.originalPath);
			else this.collapsedOriginals.add(group.originalPath);
			this.renderList();
		});
		row.addEventListener('contextmenu', (event) => {
			event.preventDefault();
			this.originalMenu(group, event);
		});
		if (collapsed) return;
		for (const conflict of conflicts) this.renderConflict(group, conflict);
	}

	private renderConflict(group: ConflictGroup, conflict: ConflictFile): void {
		if (!this.listEl) return;
		const row = this.listEl.createDiv({ cls: 'meld-conflict-row' });
		const when = formatStamp(conflict.date, conflict.time) || fileName(conflict.path);
		const label = row.createSpan({ cls: 'meld-conflict-when', text: when });
		label.title = conflict.path;
		row.createSpan({ cls: 'meld-device', text: conflict.modifiedBy || '—' });
		row.createSpan({ cls: 'meld-size', text: formatBytes(conflict.size) });
		const diff = row.createEl('button', { cls: 'meld-diff-button', text: 'Diff' });
		const open = () => {
			this.plugin.markCursor(conflict.path);
			void this.plugin.openPair(group.originalPath, conflict.path, false);
		};
		diff.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			open();
		});
		row.addEventListener('click', open);
		row.addEventListener('contextmenu', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.conflictMenu(group, conflict, event);
		});
	}

	private originalMenu(group: ConflictGroup, event: MouseEvent): void {
		const menu = new Menu();
		const file = this.plugin.app.vault.getAbstractFileByPath(group.originalPath);
		menu.addItem((item) => item.setTitle('Open original').setIcon('file').onClick(() => {
			if (file instanceof TFile) void openInNewTab(this.app, file);
			else new Notice('Original file was not found.');
		}));
		menu.addItem((item) => item.setTitle('Open diffs in sequence').setIcon('git-compare').onClick(() => {
			const first = group.conflicts[0];
			if (!first) return;
			this.plugin.markCursor(first.path);
			void this.plugin.openPair(group.originalPath, first.path, false);
		}));
		menu.addItem((item) => item.setTitle('Reveal').setIcon('folder').onClick(() => {
			if (file instanceof TFile) void revealInNavigation(this.app, file);
			else showInSystem(this.app, group.originalPath);
		}));
		menu.addItem((item) => item.setTitle('Delete all sibling conflicts').setIcon('trash').setWarning(true).onClick(() => {
			void trashConflictGroup(this.app, group);
		}));
		menu.showAtMouseEvent(event);
	}

	private conflictMenu(group: ConflictGroup, conflict: ConflictFile, event: MouseEvent): void {
		const menu = new Menu();
		const file = this.app.vault.getAbstractFileByPath(conflict.path);
		menu.addItem((item) => item.setTitle('Open diff').setIcon('git-compare').onClick(() => {
			this.plugin.markCursor(conflict.path);
			void this.plugin.openPair(group.originalPath, conflict.path, false);
		}));
		menu.addItem((item) => item.setTitle('Open diff in new tab').setIcon('file-plus').onClick(() => {
			void this.plugin.openPair(group.originalPath, conflict.path, true);
		}));
		menu.addItem((item) => item.setTitle('Open conflict file').setIcon('file').onClick(() => {
			if (file instanceof TFile) void openInNewTab(this.app, file);
		}));
		menu.addItem((item) => item.setTitle('Reveal in file explorer').setIcon('folder').onClick(() => {
			if (file instanceof TFile) void revealInNavigation(this.app, file);
		}));
		menu.addItem((item) => item.setTitle('Use original').setIcon('trash').onClick(() => { void keepOriginal(this.app, conflict.path); }));
		menu.addItem((item) => item.setTitle('Use conflict version').setIcon('replace').onClick(() => { void keepConflict(this.app, group, conflict); }));
		menu.addItem((item) => item.setTitle('Copy conflict path').setIcon('clipboard').onClick(() => {
			void navigator.clipboard.writeText(conflict.path).then(() => new Notice('Copied path'));
		}));
		menu.showAtMouseEvent(event);
	}
}

