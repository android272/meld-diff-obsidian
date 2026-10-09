import { FileSystemAdapter, Menu, Notice, TFile, type App, type TAbstractFile } from 'obsidian';
import { askString, confirm, noticeError } from '../ui/confirm';
import { isBinaryExtension, joinPath } from '../text-util';
import { pickFolder } from './file-suggest';

export async function copyPlainText(text: string, label: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
		new Notice(`Copied ${label}`);
	} catch (error) {
		noticeError(error, `Could not copy ${label}`);
	}
}

function obsidianUrl(app: App, file: TFile): string {
	return `obsidian://open?vault=${encodeURIComponent(app.vault.getName())}&file=${encodeURIComponent(file.path)}`;
}

export function showInSystem(app: App, path: string): void {
	const adapter = app.vault.adapter;
	if (!(adapter instanceof FileSystemAdapter)) {
		new Notice('Showing the system folder is only available on the desktop app.');
		return;
	}
	const opener = app as App & { showInFolder?: (fullPath: string) => void };
	if (typeof opener.showInFolder !== 'function') {
		new Notice('This Obsidian version cannot reveal the system folder.');
		return;
	}
	opener.showInFolder(adapter.getFullPath(path));
}

export async function revealInNavigation(app: App, file: TFile): Promise<void> {
	const leaf = app.workspace.getLeavesOfType('file-explorer')[0];
	if (!leaf) {
		new Notice('Open the file explorer to reveal this file.');
		return;
	}
	const deferred = leaf as typeof leaf & { loadIfDeferred?: () => Promise<void> };
	if (leaf.isDeferred && deferred.loadIfDeferred) await deferred.loadIfDeferred();
	const view = leaf.view as { revealInFolder?: (target: TAbstractFile) => void };
	if (typeof view.revealInFolder !== 'function') {
		new Notice('Could not reveal the file in the explorer.');
		return;
	}
	await app.workspace.revealLeaf(leaf);
	view.revealInFolder(file);
}

export async function openInNewTab(app: App, file: TFile): Promise<void> {
	await app.workspace.getLeaf('tab').openFile(file);
}

export async function openToTheRight(app: App, file: TFile): Promise<void> {
	await app.workspace.getLeaf('split', 'vertical').openFile(file);
}

function uniqueCopyPath(app: App, file: TFile): string {
	const parent = file.parent && !file.parent.isRoot() ? file.parent.path : '';
	const ext = file.extension ? `.${file.extension}` : '';
	for (let n = 0; n < 1000; n++) {
		const name = n === 0 ? `${file.basename} copy${ext}` : `${file.basename} copy ${n + 1}${ext}`;
		const path = joinPath(parent, name);
		if (!app.vault.getAbstractFileByPath(path)) return path;
	}
	return joinPath(parent, `${file.basename} copy ${Date.now()}${ext}`);
}

export async function duplicateFile(app: App, file: TFile): Promise<void> {
	try {
		const dest = uniqueCopyPath(app, file);
		if (isBinaryExtension(file.path)) await app.vault.createBinary(dest, await app.vault.readBinary(file));
		else await app.vault.create(dest, await app.vault.read(file));
		new Notice(`Copied to ${dest}`);
	} catch (error) {
		noticeError(error, 'Could not copy the file');
	}
}

export async function promptRename(app: App, file: TFile): Promise<void> {
	const next = await askString(app, 'Rename file', file.path, 'New vault path');
	if (!next || next === file.path) return;
	try {
		await app.fileManager.renameFile(file, next);
	} catch (error) {
		noticeError(error, 'Could not rename the file');
	}
}

export async function promptMove(app: App, file: TFile): Promise<void> {
	const folder = await pickFolder(app, 'Move to folder');
	if (!folder) return;
	const next = joinPath(folder.isRoot() ? '' : folder.path, file.name);
	if (next === file.path) return;
	if (app.vault.getAbstractFileByPath(next)) {
		new Notice('A file with that name is already in the folder.');
		return;
	}
	try {
		await app.fileManager.renameFile(file, next);
	} catch (error) {
		noticeError(error, 'Could not move the file');
	}
}

export async function trashWithConfirm(app: App, file: TFile): Promise<boolean> {
	const ok = await confirm(app, 'Delete file', `Move “${file.path}” to the trash?`);
	if (!ok) return false;
	try {
		await app.fileManager.trashFile(file);
		return true;
	} catch (error) {
		noticeError(error, 'Could not delete the file');
		return false;
	}
}

export function populateFileMenu(menu: Menu, app: App, file: TFile | null): void {
	if (!file) {
		menu.addItem((item) => item.setTitle('No file on this side').setDisabled(true));
		return;
	}
	menu.addItem((item) => item.setTitle('Open in new tab').setIcon('file-plus').onClick(() => { void openInNewTab(app, file); }));
	menu.addItem((item) => item.setTitle('Open to the right').setIcon('separator-vertical').onClick(() => { void openToTheRight(app, file); }));
	menu.addItem((item) => item.setTitle('Reveal in file explorer').setIcon('folder').onClick(() => { void revealInNavigation(app, file); }));
	menu.addItem((item) => item.setTitle('Show in system explorer').setIcon('folder-open').onClick(() => showInSystem(app, file.path)));
	menu.addSeparator();
	menu.addItem((item) => item.setTitle('Rename…').setIcon('pencil').onClick(() => { void promptRename(app, file); }));
	menu.addItem((item) => item.setTitle('Move file…').setIcon('folder-input').onClick(() => { void promptMove(app, file); }));
	menu.addItem((item) => item.setTitle('Make a copy').setIcon('copy').onClick(() => { void duplicateFile(app, file); }));
	menu.addItem((item) => item.setTitle('Copy path').setIcon('clipboard').onClick(() => { void copyPlainText(file.path, 'path'); }));
	menu.addItem((item) => item.setTitle('Copy Obsidian URL').setIcon('link').onClick(() => { void copyPlainText(obsidianUrl(app, file), 'Obsidian URL'); }));
	menu.addSeparator();
	menu.addItem((item) => item.setTitle('Delete').setIcon('trash').setWarning(true).onClick(() => { void trashWithConfirm(app, file); }));
}


