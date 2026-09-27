import { compileIgnore, matchPrepared, pathIgnored, preparePatterns } from '../patterns';
import type { ConflictFile, ConflictGroup, ConflictPattern, VaultFileInfo } from '../types';

function stampKey(file: ConflictFile): string {
	return `${file.date ?? ''}${file.time ?? ''}${file.path}`;
}

export function buildConflictGroups(
	files: readonly VaultFileInfo[],
	patterns: readonly ConflictPattern[],
	ignoreGlobs: readonly string[],
): ConflictGroup[] {
	const ignores = compileIgnore(ignoreGlobs);
	const { compiled } = preparePatterns(patterns);
	const existing = new Set(files.map((file) => file.path));
	const exists = (path: string) => existing.has(path) && !pathIgnored(path, ignores);
	const groups = new Map<string, ConflictGroup>();

	for (const file of files) {
		if (pathIgnored(file.path, ignores)) continue;
		const match = matchPrepared(file.path, compiled, exists);
		if (!match) continue;
		let originalPath = match.originalPath;
		let originalExists = match.originalExists;
		if (!originalPath || originalPath === file.path) {
			originalPath = file.path;
			originalExists = false;
		}
		const conflict: ConflictFile = {
			path: file.path,
			patternId: match.patternId,
			mtime: file.mtime,
			size: file.size,
		};
		if (match.groups.date) conflict.date = match.groups.date;
		if (match.groups.time) conflict.time = match.groups.time;
		if (match.groups.modifiedBy) conflict.modifiedBy = match.groups.modifiedBy;
		let group = groups.get(originalPath);
		if (!group) {
			group = { originalPath, originalExists, conflicts: [] };
			groups.set(originalPath, group);
		} else if (originalExists) {
			group.originalExists = true;
		}
		group.conflicts.push(conflict);
	}

	const list = [...groups.values()];
	list.sort((a, b) => a.originalPath.localeCompare(b.originalPath));
	for (const group of list) group.conflicts.sort((a, b) => stampKey(a).localeCompare(stampKey(b)));
	return list;
}
