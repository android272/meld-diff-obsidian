import { App, Modal, Notice } from 'obsidian';
import { SAVE_NEEDS_FILE } from '../diff/blank-side';

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

export function askDirty(app: App, sideLabel: string, canSave: boolean): Promise<'save' | 'discard' | 'cancel'> {
	return new Promise((resolve) => {
		const flag = { done: false };
		const modal = new Modal(app);
		modal.titleEl.setText(`${sideLabel} has unsaved edits`);
		modal.contentEl.createEl('p', {
			text: canSave
				? 'Save the edits, discard them, or cancel and keep this file open.'
				: `${SAVE_NEEDS_FILE} Discard the edits, or cancel and keep them.`,
		});
		const row = modal.contentEl.createDiv({ cls: 'modal-button-container' });
		const cancel = row.createEl('button', { text: 'Cancel' });
		const discard = row.createEl('button', { text: 'Discard' });
		const save = row.createEl('button', { text: 'Save', cls: canSave ? 'mod-cta' : '' });
		save.disabled = !canSave;
		if (!canSave) {
			save.title = SAVE_NEEDS_FILE;
			save.setAttribute('aria-label', SAVE_NEEDS_FILE);
		}
		cancel.addEventListener('click', () => {
			settle(flag, resolve, 'cancel');
			modal.close();
		});
		discard.addEventListener('click', () => {
			settle(flag, resolve, 'discard');
			modal.close();
		});
		if (canSave) {
			save.addEventListener('click', () => {
				settle(flag, resolve, 'save');
				modal.close();
			});
		}
		modal.onClose = () => {
			modal.contentEl.empty();
			settle(flag, resolve, 'cancel');
		};
		modal.open();
	});
}

export function askString(app: App, title: string, initial: string, label: string): Promise<string | null> {
	return new Promise((resolve) => {
		const flag = { done: false };
		const modal = new Modal(app);
		modal.titleEl.setText(title);
		modal.contentEl.createEl('label', { text: label });
		const input = modal.contentEl.createEl('input', { type: 'text', value: initial });
		input.style.width = '100%';
		const row = modal.contentEl.createDiv({ cls: 'modal-button-container' });
		const cancel = row.createEl('button', { text: 'Cancel' });
		const ok = row.createEl('button', { text: 'Rename', cls: 'mod-cta' });
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
