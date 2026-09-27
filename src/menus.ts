import { Menu, Notice, TFile } from 'obsidian';
import { pickConflictFile, pickVaultFile } from './diff/file-suggest';
import { formatStamp, parentPath } from './text-util';
import type { ConflictFile } from './types';
import type MeldDiffPlugin from './main';

function conflictLabel(conflict: ConflictFile): string {
	const when = formatStamp(conflict.date, conflict.time);
	const device = conflict.modifiedBy ? ` ${conflict.modifiedBy}` : '';
	return when ? `${when}${device}` : conflict.path;
}

function openOriginalAndConflict(plugin: MeldDiffPlugin, original: string, conflict: string): void {
	const left = plugin.settings.defaultLeftIsOriginal ? original : conflict;
	const right = plugin.settings.defaultLeftIsOriginal ? conflict : original;
	void plugin.openPaths(left, right, { placement: 'reveal', preferCenter: true, prompt: true });
}

async function compareWithConflicts(plugin: MeldDiffPlugin, original: string, conflicts: ConflictFile[]): Promise<void> {
	const only = conflicts[0];
	if (conflicts.length === 1 && only) {
		openOriginalAndConflict(plugin, original, only.path);
		return;
	}
	const picked = await pickConflictFile(plugin.app, conflicts);
	if (picked) openOriginalAndConflict(plugin, original, picked.path);
}

export function registerMenus(plugin: MeldDiffPlugin): void {
	plugin.registerEvent(plugin.app.workspace.on('file-menu', (menu, file) => {
		if (file instanceof TFile) addCompareItems(menu, plugin, file);
	}));
	plugin.registerEvent(plugin.app.workspace.on('editor-menu', (menu, _editor, info) => {
		const file = info.file;
		if (file) addCompareItems(menu, plugin, file);
	}));
	plugin.registerEvent(plugin.app.workspace.on('files-menu', (menu, files) => {
		const picked = files.filter((file): file is TFile => file instanceof TFile);
		const left = picked[0];
		const right = picked[1];
		if (picked.length !== 2 || !left || !right) return;
		menu.addItem((item) => item
			.setTitle('Compare selected files')
			.setIcon('git-compare')
			.onClick(() => {
				void plugin.openPaths(left.path, right.path, { placement: 'reveal', preferCenter: true, prompt: true });
			}));
	}));
}

function addCompareItems(menu: Menu, plugin: MeldDiffPlugin, file: TFile): void {
	menu.addSeparator();
	menu.addItem((item) => item.setTitle('Compare with…').setIcon('git-compare').onClick(() => {
		void (async () => {
			const other = await pickVaultFile(plugin.app, 'Compare with…', parentPath(file.path));
			if (!other) return;
			await plugin.openPaths(file.path, other, { placement: 'reveal', preferCenter: true, prompt: true });
		})();
	}));
	if (plugin.index.isConflict(file.path)) {
		const original = plugin.index.originalFor(file.path);
		menu.addItem((item) => item.setTitle('Compare with original').setIcon('git-compare').onClick(() => {
			if (!original) {
				new Notice('Could not recover the original path.');
				return;
			}
			openOriginalAndConflict(plugin, original, file.path);
		}));
		return;
	}
	const conflicts = plugin.index.conflictsFor(file.path);
	if (conflicts.length === 0) return;
	menu.addItem((item) => {
		item.setTitle('Compare with conflict').setIcon('alert-triangle');
		const submenu = (item as { setSubmenu?: () => Menu }).setSubmenu;
		if (conflicts.length > 1 && typeof submenu === 'function') {
			const sub = submenu.call(item);
			for (const conflict of conflicts) {
				sub.addItem((child) => child.setTitle(conflictLabel(conflict)).onClick(() => {
					openOriginalAndConflict(plugin, file.path, conflict.path);
				}));
			}
			return;
		}
		item.onClick(() => { void compareWithConflicts(plugin, file.path, conflicts); });
	});
}

