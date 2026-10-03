import { App, Modal, Notice } from 'obsidian';

function settle<T>(flag: { done: boolean }, resolve: (value: T) => void, value: T): void {
	if (flag.done) return;
	flag.done = true;
	resolve(value);
}

export function confirm(app: App, title: string, message: string): Promise<boolean> {
	return new Promise((resolve) => {
		const flag = { done: false };
		const modal = new Modal(app);
		modal.titleEl.setText(title);
		modal.contentEl.createEl('p', { text: message });
		const row = modal.contentEl.createDiv({ cls: 'modal-button-container' });
		const cancel = row.createEl('button', { text: 'Cancel' });
		const ok = row.createEl('button', { text: 'Continue', cls: 'mod-warning' });
		cancel.addEventListener('click', () => {
			settle(flag, resolve, false);
			modal.close();
		});
		ok.addEventListener('click', () => {
			settle(flag, resolve, true);
			modal.close();
		});
		modal.onClose = () => {
			modal.contentEl.empty();
			settle(flag, resolve, false);
		};
		modal.open();
	});
}

/** Linked notes offer Save. Text with no note offers Save as. */
export function askUnsaved(app: App, letter: 'A' | 'B', mode: 'save' | 'save-as'): Promise<'save' | 'discard' | 'cancel'> {
	const saveAs = mode === 'save-as';
	return new Promise((resolve) => {
		const flag = { done: false };
		const modal = new Modal(app);
		modal.titleEl.setText(saveAs ? `${letter} not saved to a note` : `${letter} has unsaved edits`);
		modal.contentEl.createEl('p', {
			text: saveAs
				? 'Save it as a new note, discard it, or cancel and keep this diff open.'
				: 'Save the note, discard the edits, or cancel and keep this diff open.',
		});
		const row = modal.contentEl.createDiv({ cls: 'modal-button-container' });
		const cancel = row.createEl('button', { text: 'Cancel' });
		const discard = row.createEl('button', { text: 'Discard' });
		const save = row.createEl('button', { text: saveAs ? 'Save as' : 'Save', cls: 'mod-cta' });
		cancel.addEventListener('click', () => {
			settle(flag, resolve, 'cancel');
			modal.close();
		});
		discard.addEventListener('click', () => {
			settle(flag, resolve, 'discard');
			modal.close();
		});
		save.addEventListener('click', () => {
			settle(flag, resolve, 'save');
			modal.close();
		});
		modal.onClose = () => {
			modal.contentEl.empty();
			settle(flag, resolve, 'cancel');
		};
		modal.open();
	});
}

export function askString(app: App, title: string, initial: string, label: string, confirmLabel = 'Rename'): Promise<string | null> {
	return new Promise((resolve) => {
		const flag = { done: false };
		const modal = new Modal(app);
		modal.titleEl.setText(title);
		modal.contentEl.createEl('label', { text: label });
		const input = modal.contentEl.createEl('input', { type: 'text', value: initial });
		input.style.width = '100%';
		const row = modal.contentEl.createDiv({ cls: 'modal-button-container' });
		const cancel = row.createEl('button', { text: 'Cancel' });
		const ok = row.createEl('button', { text: confirmLabel, cls: 'mod-cta' });
		const submit = () => {
			const value = input.value.trim();
			settle(flag, resolve, value || null);
			modal.close();
		};
		cancel.addEventListener('click', () => {
			settle(flag, resolve, null);
			modal.close();
		});
		ok.addEventListener('click', submit);
		input.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				submit();
			}
		});
		modal.onClose = () => {
			modal.contentEl.empty();
			settle(flag, resolve, null);
		};
		modal.open();
		window.setTimeout(() => {
			input.focus();
			input.select();
		}, 0);
	});
}

export function noticeError(error: unknown, fallback: string): void {
	console.error(error);
	const message = error instanceof Error && error.message ? error.message : fallback;
	new Notice(`Meld Diff: ${message}`);
}
