import { Notice, TFile, type App } from 'obsidian';
import { confirm, noticeError } from './ui/confirm';
import { isBinaryExtension } from './text-util';
import type { ConflictFile, ConflictGroup } from './types';

function fileAt(app: App, path: string): TFile | null {
	const file = app.vault.getAbstractFileByPath(path);
	return file instanceof TFile ? file : null;
}

export async function keepOriginal(app: App, conflictPath: string): Promise<void> {
	const conflict = fileAt(app, conflictPath);
	if (!conflict) {
		new Notice('That conflict file is no longer in the vault.');
		return;
	}
	const ok = await confirm(app, 'Use original', `Delete the conflict file “${conflict.path}” and keep the original?`);
	if (!ok) return;
	try {
		await app.fileManager.trashFile(conflict);
		new Notice('Deleted the conflict file.');
	} catch (error) {
		noticeError(error, 'Could not delete the conflict file');
	}
}

export async function keepConflict(app: App, group: ConflictGroup, conflict: ConflictFile): Promise<void> {
	const conflictFile = fileAt(app, conflict.path);
	if (!conflictFile) {
		new Notice('That conflict file is no longer in the vault.');
		return;
	}
	const ok = await confirm(
		app,
		'Use conflict version',
		group.originalExists
			? `Overwrite “${group.originalPath}” with “${conflict.path}”, then delete the conflict file?`
			: `Rename “${conflict.path}” to “${group.originalPath}”?`,
	);
	if (!ok) return;
	try {
		if (!group.originalExists || group.originalPath === conflict.path) {
			await app.fileManager.renameFile(conflictFile, group.originalPath);
			new Notice('Kept the conflict version.');
			return;
		}
		const original = fileAt(app, group.originalPath);
		if (!original) {
			await app.fileManager.renameFile(conflictFile, group.originalPath);
			new Notice('Kept the conflict version.');
			return;
		}
		if (isBinaryExtension(conflict.path) || isBinaryExtension(original.path)) {
			await app.vault.modifyBinary(original, await app.vault.readBinary(conflictFile));
		} else {
			await app.vault.modify(original, await app.vault.read(conflictFile));
		}
		await app.fileManager.trashFile(conflictFile);
		new Notice('Replaced the original and deleted the conflict file.');
	} catch (error) {
		noticeError(error, 'Could not apply the conflict version');
	}
}

export async function trashConflictGroup(app: App, group: ConflictGroup): Promise<void> {
	const count = group.conflicts.length;
	const ok = await confirm(app, 'Delete conflict files', `Move ${count} conflict file${count === 1 ? '' : 's'} for “${group.originalPath}” to the trash?`);
	if (!ok) return;
	try {
		for (const conflict of group.conflicts) {
			const file = fileAt(app, conflict.path);
			if (file) await app.fileManager.trashFile(file);
		}
		new Notice('Deleted the conflict files.');
	} catch (error) {
		noticeError(error, 'Could not delete every conflict file');
	}
}
