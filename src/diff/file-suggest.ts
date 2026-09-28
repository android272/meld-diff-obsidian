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

/**
 * SuggestModal.selectSuggestion closes the modal before onChooseItem.
 * Record the choice first, then resolve. A plain dismiss waits one turn
 * so a choice later in the same call still wins.
 */
function choiceSlot<T>(resolve: (value: T | null) => void): {
	accept: (value: T) => void;
	close: () => void;
} {
	const slot = { chose: false, settled: false, pending: null as T | null };
	const finish = () => {
		if (slot.settled) return;
		if (!slot.chose) {
			queueMicrotask(() => {
				if (slot.settled) return;
				slot.settled = true;
				resolve(null);
			});
			return;
		}
		slot.settled = true;
		resolve(slot.pending);
	};
	return {
		accept(value: T) {
			slot.chose = true;
			slot.pending = value;
			finish();
		},
		close: finish,
	};
}

export function pickVaultFile(app: App, placeholder: string, boostFolder?: string): Promise<string | null> {
	return new Promise((resolve) => {
		const modal = new FileSuggestModal(app, placeholder, boostFolder, resolve);
		modal.open();
	});
}

class FileSuggestModal extends FuzzySuggestModal<TFile | string> {
	private readonly choice: ReturnType<typeof choiceSlot<string>>;

	constructor(
		app: App,
		placeholder: string,
		private readonly boostFolder: string | undefined,
		resolve: (path: string | null) => void,
	) {
		super(app);
		this.choice = choiceSlot(resolve);
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

	selectSuggestion(item: FuzzyMatch<TFile | string>, evt: MouseEvent | KeyboardEvent): void {
		const chosen = item?.item;
		if (typeof chosen === 'string' || chosen instanceof TFile) {
			this.choice.accept(typeof chosen === 'string' ? chosen : chosen.path);
		}
		super.selectSuggestion(item, evt);
	}

	onChooseItem(item: TFile | string): void {
		this.choice.accept(typeof item === 'string' ? item : item.path);
	}

	onClose(): void {
		super.onClose();
		this.choice.close();
	}
}

export function pickConflictFile(app: App, conflicts: ConflictFile[]): Promise<ConflictFile | null> {
	return new Promise((resolve) => {
		const modal = new ConflictSuggestModal(app, conflicts, resolve);
		modal.open();
	});
}

class ConflictSuggestModal extends FuzzySuggestModal<ConflictFile> {
	private readonly choice: ReturnType<typeof choiceSlot<ConflictFile>>;

	constructor(app: App, private readonly conflicts: ConflictFile[], resolve: (file: ConflictFile | null) => void) {
		super(app);
		this.choice = choiceSlot(resolve);
		this.setPlaceholder('Choose a conflict file');
	}

	getItems(): ConflictFile[] {
		return this.conflicts;
	}

	getItemText(item: ConflictFile): string {
		const when = [item.date, item.time].filter(Boolean).join(' ');
		return when ? `${item.path} ${when}` : item.path;
	}

	selectSuggestion(item: FuzzyMatch<ConflictFile>, evt: MouseEvent | KeyboardEvent): void {
		if (item?.item) this.choice.accept(item.item);
		super.selectSuggestion(item, evt);
	}

	onChooseItem(item: ConflictFile): void {
		this.choice.accept(item);
	}

	onClose(): void {
		super.onClose();
		this.choice.close();
	}
}

export function pickFolder(app: App, placeholder: string): Promise<TFolder | null> {
	return new Promise((resolve) => {
		const modal = new FolderSuggestModal(app, placeholder, resolve);
		modal.open();
	});
}

class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
	private readonly choice: ReturnType<typeof choiceSlot<TFolder>>;

	constructor(app: App, placeholder: string, resolve: (folder: TFolder | null) => void) {
		super(app);
		this.choice = choiceSlot(resolve);
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

	selectSuggestion(item: FuzzyMatch<TFolder>, evt: MouseEvent | KeyboardEvent): void {
		if (item?.item) this.choice.accept(item.item);
		super.selectSuggestion(item, evt);
	}

	onChooseItem(folder: TFolder): void {
		this.choice.accept(folder);
	}

	onClose(): void {
		super.onClose();
		this.choice.close();
	}
}
