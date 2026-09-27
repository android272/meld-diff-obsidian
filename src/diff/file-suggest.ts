import { FuzzySuggestModal, TFile, TFolder, type App, type FuzzyMatch } from 'obsidian';
import type { ConflictFile } from '../types';

const TEXT_EXTENSIONS = new Set([
	'md', 'markdown', 'txt', 'text', 'csv', 'tsv', 'json', 'yaml', 'yml', 'xml', 'html', 'css',
	'js', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'hpp', 'sh',
	'bash', 'zsh', 'toml', 'ini', 'log', 'org', 'tex', 'rst',
]);

function sameFolder(file: TFile, folder: string | undefined): boolean {
	if (!folder) return false;
	const parent = file.parent;
	if (!parent) return false;
	if (folder === '/' || folder === '') return parent.isRoot();
	return parent.path === folder;
}

export function pickVaultFile(app: App, placeholder: string, boostFolder?: string): Promise<string | null> {
	return new Promise((resolve) => {
		const modal = new FileSuggestModal(app, placeholder, boostFolder, resolve);
		modal.open();
	});
}

class FileSuggestModal extends FuzzySuggestModal<TFile | string> {
	private chose = false;

	constructor(
		app: App,
		placeholder: string,
		private readonly boostFolder: string | undefined,
		private readonly resolve: (path: string | null) => void,
	) {
		super(app);
		this.setPlaceholder(placeholder);
		this.setInstructions([
			{ command: '↑↓', purpose: 'to navigate' },
			{ command: '↵', purpose: 'to choose' },
		]);
	}

	getItems(): Array<TFile | string> {
		const files = this.app.vault.getFiles();
		return files.sort((a, b) => {
			const ar = (sameFolder(a, this.boostFolder) ? 0 : 2) + (TEXT_EXTENSIONS.has(a.extension.toLowerCase()) ? 0 : 1);
			const br = (sameFolder(b, this.boostFolder) ? 0 : 2) + (TEXT_EXTENSIONS.has(b.extension.toLowerCase()) ? 0 : 1);
			if (ar !== br) return ar - br;
			return a.path.localeCompare(b.path);
		});
	}

	getItemText(item: TFile | string): string {
		return typeof item === 'string' ? item : item.path;
	}

	getSuggestions(query: string): FuzzyMatch<TFile | string>[] {
		const matches = super.getSuggestions(query);
		const typed = query.trim();
		if (matches.length === 0 && typed) return [{ item: typed, match: { score: 0, matches: [] } }];
		return matches;
	}

	renderSuggestion(match: FuzzyMatch<TFile | string>, el: HTMLElement): void {
		if (typeof match.item === 'string') {
			el.createDiv({ text: match.item });
			el.createEl('small', { text: 'Use this path' });
			return;
		}
		super.renderSuggestion(match, el);
	}

	onChooseItem(item: TFile | string): void {
		this.chose = true;
		this.resolve(typeof item === 'string' ? item : item.path);
	}

	onClose(): void {
		super.onClose();
		if (!this.chose) this.resolve(null);
	}
}

export function pickConflictFile(app: App, conflicts: ConflictFile[]): Promise<ConflictFile | null> {
	return new Promise((resolve) => {
		const modal = new ConflictSuggestModal(app, conflicts, resolve);
		modal.open();
	});
}

class ConflictSuggestModal extends FuzzySuggestModal<ConflictFile> {
	private chose = false;

	constructor(app: App, private readonly conflicts: ConflictFile[], private readonly resolve: (file: ConflictFile | null) => void) {
		super(app);
		this.setPlaceholder('Choose a conflict file');
	}

	getItems(): ConflictFile[] {
		return this.conflicts;
	}

	getItemText(item: ConflictFile): string {
		const when = [item.date, item.time].filter(Boolean).join(' ');
		return when ? `${item.path} ${when}` : item.path;
	}

	onChooseItem(item: ConflictFile): void {
		this.chose = true;
		this.resolve(item);
	}

	onClose(): void {
		super.onClose();
		if (!this.chose) this.resolve(null);
	}
}

export function pickFolder(app: App, placeholder: string): Promise<TFolder | null> {
	return new Promise((resolve) => {
		const modal = new FolderSuggestModal(app, placeholder, resolve);
		modal.open();
	});
}

class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
	private chose = false;

	constructor(app: App, placeholder: string, private readonly resolve: (folder: TFolder | null) => void) {
		super(app);
		this.setPlaceholder(placeholder);
	}

	getItems(): TFolder[] {
		const out: TFolder[] = [];
		const walk = (folder: TFolder) => {
			out.push(folder);
			for (const child of folder.children) {
				if (child instanceof TFolder) walk(child);
			}
		};
		walk(this.app.vault.getRoot());
		return out;
	}

	getItemText(folder: TFolder): string {
		return folder.isRoot() ? '/' : folder.path;
	}

	onChooseItem(folder: TFolder): void {
		this.chose = true;
		this.resolve(folder);
	}

	onClose(): void {
		super.onClose();
		if (!this.chose) this.resolve(null);
	}
}
