import { type App, type DataAdapter, TFile } from 'obsidian';
import { buildConflictGroups } from './group-conflicts';
import { compileIgnore, pathIgnored } from '../patterns';
import type { ConflictFile, ConflictGroup, MeldDiffSettings, VaultFileInfo } from '../types';

export interface FlatConflict {
	group: ConflictGroup;
	conflict: ConflictFile;
}

async function listDirectory(adapter: DataAdapter, dir: string): Promise<{ files: string[]; folders: string[] } | null> {
	const candidates = dir === '' || dir === '/' ? ['/', ''] : [dir];
	for (const candidate of candidates) {
		try {
			const listed = await adapter.list(candidate);
			if (listed) return listed;
		} catch {
			// Try the other root spelling.
		}
	}
	return null;
}

function normPath(path: string): string {
	return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

export class ConflictIndex {
	private groups: ConflictGroup[] = [];
	private byOriginal = new Map<string, ConflictGroup>();
	private byConflict = new Map<string, { group: ConflictGroup; file: ConflictFile }>();
	private listeners = new Set<() => void>();
	private timer: number | null = null;
	private generation = 0;
	private dead = false;
	private extrasEpoch = 1;
	private scannedEpoch = 0;
	private extraCache: VaultFileInfo[] = [];
	ready = false;
	scanning = false;

	constructor(private readonly app: App, private readonly getSettings: () => MeldDiffSettings) {}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	listGroups(): ConflictGroup[] {
		return this.groups;
	}

	flat(): FlatConflict[] {
		const out: FlatConflict[] = [];
		for (const group of this.groups) {
			for (const conflict of group.conflicts) out.push({ group, conflict });
		}
		return out;
	}

	conflictCount(): number {
		let count = 0;
		for (const group of this.groups) count += group.conflicts.length;
		return count;
	}

	conflictsFor(originalPath: string): ConflictFile[] {
		return this.byOriginal.get(originalPath)?.conflicts ?? [];
	}

	isConflict(path: string): boolean {
		return this.byConflict.has(path);
	}

	originalFor(conflictPath: string): string | null {
		return this.byConflict.get(conflictPath)?.group.originalPath ?? null;
	}

	/** @param rescanExtras Walk the disk for extensions Obsidian does not index. Skip this on ordinary modifies. */
	queue(rescanExtras = false): void {
		if (this.dead) return;
		if (rescanExtras) this.extrasEpoch++;
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			this.timer = null;
			void this.rebuild();
		}, 250);
	}

	async rebuild(): Promise<void> {
		if (this.dead) return;
		const generation = ++this.generation;
		this.scanning = true;
		this.emit();
		try {
			const settings = this.getSettings();
			const files = await this.collectFiles(settings);
			if (generation !== this.generation || this.dead) return;
			this.groups = buildConflictGroups(files, settings.patterns, settings.ignoreGlobs);
			this.reindex();
			this.ready = true;
		} catch (error) {
			console.error('Meld Diff: conflict scan failed', error);
			this.ready = true;
		} finally {
			if (generation === this.generation) {
				this.scanning = false;
				this.emit();
			}
		}
	}

	dispose(): void {
		this.dead = true;
		this.generation++;
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = null;
		this.listeners.clear();
	}

	private reindex(): void {
		this.byOriginal = new Map(this.groups.map((group) => [group.originalPath, group]));
		this.byConflict = new Map();
		for (const group of this.groups) {
			for (const file of group.conflicts) this.byConflict.set(file.path, { group, file });
		}
	}

	private emit(): void {
		for (const listener of [...this.listeners]) {
			try {
				listener();
			} catch (error) {
				console.error('Meld Diff: index listener failed', error);
			}
		}
	}

	private async collectFiles(settings: MeldDiffSettings): Promise<VaultFileInfo[]> {
		const known = new Map<string, VaultFileInfo>();
		for (const file of this.app.vault.getFiles()) {
			known.set(file.path, { path: file.path, mtime: file.stat.mtime, size: file.stat.size });
		}
		if (settings.includeUnrecognizedExtensions) {
			const epoch = this.extrasEpoch;
			if (epoch !== this.scannedEpoch) {
				this.extraCache = await this.unindexedConflicts(known, settings);
				if (epoch === this.extrasEpoch) this.scannedEpoch = epoch;
			}
			for (const extra of this.extraCache) {
				if (!known.has(extra.path)) known.set(extra.path, extra);
			}
		}
		return [...known.values()];
	}

	private async unindexedConflicts(known: Map<string, VaultFileInfo>, settings: MeldDiffSettings): Promise<VaultFileInfo[]> {
		const ignores = compileIgnore(settings.ignoreGlobs);
		const adapter = this.app.vault.adapter;
		const found: VaultFileInfo[] = [];
		const queue: string[] = [''];
		const seen = new Set<string>();
		while (queue.length > 0) {
			const dir = queue.pop();
			if (dir === undefined || seen.has(dir)) continue;
			seen.add(dir);
			const listed = await listDirectory(adapter, dir);
			if (!listed) continue;
			for (const folder of listed.folders) {
				const normalized = normPath(folder);
				if (!normalized || seen.has(normalized)) continue;
				if (pathIgnored(normalized, ignores) || pathIgnored(`${normalized}/x`, ignores)) continue;
				queue.push(normalized);
			}
			for (const file of listed.files) {
				const path = normPath(file);
				if (!path || known.has(path) || pathIgnored(path, ignores)) continue;
				const abstract = this.app.vault.getAbstractFileByPath(path);
				if (abstract instanceof TFile) continue;
				found.push({ path, mtime: 0, size: 0 });
			}
		}
		const matched: VaultFileInfo[] = [];
		const preliminary = buildConflictGroups(found, settings.patterns, settings.ignoreGlobs);
		const wanted = new Set<string>();
		for (const item of preliminary) {
			for (const conflict of item.conflicts) wanted.add(conflict.path);
		}
		for (const file of found) {
			if (!wanted.has(file.path)) continue;
			try {
				const stat = await adapter.stat(file.path);
				matched.push({ path: file.path, mtime: stat?.mtime ?? 0, size: stat?.size ?? 0 });
			} catch {
				matched.push(file);
			}
		}
		return matched;
	}
}
