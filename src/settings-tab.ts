import { PluginSettingTab, Setting, type App } from 'obsidian';
import type MeldDiffPlugin from './main';
import { explainPattern } from './patterns';
import { blankPreset, newId, nextcloudPreset, obsidianSyncPreset, syncthingPreset } from './settings';
import type { ConflictPattern } from './types';

export class MeldDiffSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: MeldDiffPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('meld-settings');
		containerEl.createEl('p', {
			cls: 'meld-settings-intro',
			text: 'Meld Diff finds sync conflict files and opens them in a split source editor. Patterns run in order. The first match picks the original path.',
		});

		new Setting(containerEl).setName('Patterns').setHeading();
		const presets = containerEl.createDiv({ cls: 'meld-preset-row' });
		this.presetButton(presets, 'Syncthing', () => syncthingPreset(newId()));
		this.presetButton(presets, 'Obsidian Sync', () => obsidianSyncPreset(newId()));
		this.presetButton(presets, 'Nextcloud', () => nextcloudPreset(newId()));
		this.presetButton(presets, 'Blank', () => blankPreset());

		this.plugin.settings.patterns.forEach((pattern, index) => this.renderPattern(containerEl, pattern, index));

		new Setting(containerEl)
			.setName('Ignore globs')
			.setDesc('One glob per line. Files under these paths are never conflicts or originals. * and ** both work.')
			.setClass('meld-ignore-globs')
			.addTextArea((area) => {
				area.inputEl.addClass('meld-ignore-globs-input');
				area.setValue(this.plugin.settings.ignoreGlobs.join('\n'));
				area.onChange((value) => {
					this.plugin.settings.ignoreGlobs = value.split('\n').map((line) => line.trim()).filter(Boolean);
					void this.plugin.saveSettings(true);
				});
			});

		new Setting(containerEl)
			.setName('Include unrecognized extensions')
			.setDesc('Also scan names Obsidian does not index, so a conflicted image still shows up in the list.')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.includeUnrecognizedExtensions)
				.onChange((value) => {
					this.plugin.settings.includeUnrecognizedExtensions = value;
					void this.plugin.saveSettings(true);
				}));

		new Setting(containerEl)
			.setName('Scan on startup')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.scanOnStartup)
				.onChange((value) => {
					this.plugin.settings.scanOnStartup = value;
					void this.plugin.saveSettings(false);
				}));

		new Setting(containerEl)
			.setName('Rescan now')
			.addButton((button) => button.setButtonText('Rescan').onClick(() => this.plugin.rescan()));

		new Setting(containerEl).setName('Appearance').setHeading();
		this.toggle(containerEl, 'Status bar', 'Show the conflict count. Click it to open Conflict View.', this.plugin.settings.statusBarEnabled, (value) => {
			this.plugin.settings.statusBarEnabled = value;
		}, false);
		let conflictRibbonEl: HTMLElement | null = null;
		let diffRibbonEl: HTMLElement | null = null;
		const showRibbonButtons = (enabled: boolean) => {
			conflictRibbonEl?.toggleClass('meld-setting-hidden', !enabled);
			diffRibbonEl?.toggleClass('meld-setting-hidden', !enabled);
		};
		this.toggle(containerEl, 'Ribbon icons', 'Master switch for both left-ribbon buttons.', this.plugin.settings.ribbonEnabled, (value) => {
			this.plugin.settings.ribbonEnabled = value;
			showRibbonButtons(value);
		}, false);
		conflictRibbonEl = this.toggle(containerEl, 'Conflicts ribbon button', '', this.plugin.settings.ribbonConflicts, (value) => {
			this.plugin.settings.ribbonConflicts = value;
		}, false);
		diffRibbonEl = this.toggle(containerEl, 'Diff ribbon button', '', this.plugin.settings.ribbonDiff, (value) => {
			this.plugin.settings.ribbonDiff = value;
		}, false);
		showRibbonButtons(this.plugin.settings.ribbonEnabled);
		this.toggle(containerEl, 'Original on the left', 'Conflict View opens the original on the left and the conflict on the right.', this.plugin.settings.defaultLeftIsOriginal, (value) => {
			this.plugin.settings.defaultLeftIsOriginal = value;
		}, false);
		new Setting(containerEl).setName('Diff display').setHeading();
		this.toggle(containerEl, 'Align scroll', 'Keep both sides scrolled together.', this.plugin.settings.alignScroll, (value) => {
			this.plugin.settings.alignScroll = value;
		}, false);
		this.toggle(containerEl, 'Show current line', 'Highlight the line the cursor is on.', this.plugin.settings.showCurrentLine, (value) => {
			this.plugin.settings.showCurrentLine = value;
		}, false);
		this.toggle(containerEl, 'Show line numbers', '', this.plugin.settings.showLineNumbers, (value) => {
			this.plugin.settings.showLineNumbers = value;
		}, false);
		this.toggle(containerEl, 'Show whitespace', 'Changed lines always show spaces, tabs, and line endings. Turn this on to draw them in the rest of the file too. Nothing extra is saved.', this.plugin.settings.showWhitespace, (value) => {
			this.plugin.settings.showWhitespace = value;
		}, false);
		this.toggle(containerEl, 'Text wrapping', '', this.plugin.settings.wrapLines, (value) => {
			this.plugin.settings.wrapLines = value;
		}, false);
		this.toggle(containerEl, 'Highlight changes inside a line', 'Color the characters and punctuation that differ, not only the whole line.', this.plugin.settings.showIntraLine, (value) => {
			this.plugin.settings.showIntraLine = value;
		}, false);
		this.toggle(containerEl, 'Collapse unchanged regions', '', this.plugin.settings.collapseUnchanged, (value) => {
			this.plugin.settings.collapseUnchanged = value;
		}, false);

		new Setting(containerEl)
			.setName('Unchanged lines to keep')
			.setDesc('How many unchanged lines stay visible around a change when collapsing is on.')
			.addText((text) => text
				.setValue(String(this.plugin.settings.collapseMargin))
				.onChange((value) => {
					this.plugin.settings.collapseMargin = clamp(Number(value), 0, 50, this.plugin.settings.collapseMargin);
					void this.plugin.saveSettings(false);
				}));

		new Setting(containerEl).setName('Saving').setHeading();
		let delayEl: HTMLElement | null = null;
		const showDelay = (enabled: boolean) => delayEl?.toggleClass('meld-setting-hidden', !enabled);
		this.toggle(containerEl, 'Autosave after edits', 'Off by default. Saves an existing file after you stop typing.', this.plugin.settings.autosave, (value) => {
			this.plugin.settings.autosave = value;
			showDelay(value);
		}, false);
		const delay = new Setting(containerEl)
			.setName('Autosave delay (ms)')
			.addText((text) => text
				.setValue(String(this.plugin.settings.autosaveMs))
				.onChange((value) => {
					this.plugin.settings.autosaveMs = clamp(Number(value), 100, 60000, 750);
					void this.plugin.saveSettings(false);
				}));
		delayEl = delay.settingEl;
		showDelay(this.plugin.settings.autosave);

		new Setting(containerEl).setName('Advanced').setHeading();
		new Setting(containerEl)
			.setName('Diff scan limit')
			.setDesc('Maximum characters compared precisely inside one changed region. Higher is more accurate and slower.')
			.addText((text) => text
				.setValue(String(this.plugin.settings.scanLimit))
				.onChange((value) => {
					this.plugin.settings.scanLimit = clamp(Number(value), 100, 500000, 10000);
					void this.plugin.saveSettings(false);
				}));
	}

	hide(): void {
		this.containerEl.empty();
	}

	private toggle(container: HTMLElement, name: string, desc: string, value: boolean, apply: (value: boolean) => void, extras: boolean): HTMLElement {
		const setting = new Setting(container).setName(name);
		if (desc) setting.setDesc(desc);
		setting.addToggle((toggle) => toggle.setValue(value).onChange((next) => {
			apply(next);
			void this.plugin.saveSettings(extras);
		}));
		return setting.settingEl;
	}

	private presetButton(parent: HTMLElement, label: string, create: () => ConflictPattern): void {
		const button = parent.createEl('button', { text: label });
		button.addEventListener('click', () => {
			this.plugin.settings.patterns.push(create());
			void this.plugin.saveSettings(true);
			this.display();
		});
	}

	private renderPattern(container: HTMLElement, pattern: ConflictPattern, index: number): void {
		const card = container.createDiv({ cls: 'meld-pattern-card' });
		const head = card.createDiv({ cls: 'meld-pattern-head' });
		const name = head.createEl('input', { type: 'text', value: pattern.name, cls: 'meld-input' });
		name.addEventListener('change', () => {
			pattern.name = name.value;
			void this.plugin.saveSettings(false);
		});
		const enabled = head.createEl('label', { cls: 'meld-check' });
		const checkbox = enabled.createEl('input', { type: 'checkbox' });
		checkbox.checked = pattern.enabled;
		enabled.createSpan({ text: 'Enabled' });
		checkbox.addEventListener('change', () => {
			pattern.enabled = checkbox.checked;
			void this.plugin.saveSettings(true);
		});
		const mode = head.createEl('select', { cls: 'dropdown' });
		mode.createEl('option', { text: 'Regex', value: 'regex' });
		mode.createEl('option', { text: 'Glob', value: 'glob' });
		mode.value = pattern.mode;
		mode.addEventListener('change', () => {
			pattern.mode = mode.value === 'glob' ? 'glob' : 'regex';
			void this.plugin.saveSettings(true);
		});
		this.smallButton(head, 'Up', () => this.move(index, -1));
		this.smallButton(head, 'Down', () => this.move(index, 1));
		this.smallButton(head, 'Remove', () => {
			this.plugin.settings.patterns.splice(index, 1);
			void this.plugin.saveSettings(true);
			this.display();
		});

		const expression = card.createEl('textarea', { cls: 'meld-textarea', text: pattern.expression });
		expression.placeholder = pattern.mode === 'glob' ? '**/* (conflicted copy *).*' : 'Regular expression';
		expression.value = pattern.expression;
		const error = card.createDiv({ cls: 'meld-pattern-error' });
		const showError = () => {
			if (pattern.mode !== 'regex' || !pattern.expression.trim()) {
				error.setText(pattern.expression.trim() ? '' : 'Expression is empty');
				return;
			}
			try {
				new RegExp(pattern.expression);
				error.setText('');
			} catch (err) {
				error.setText(err instanceof Error ? err.message : 'Invalid regular expression');
			}
		};
		expression.addEventListener('input', () => {
			pattern.expression = expression.value;
		});
		expression.addEventListener('blur', () => {
			showError();
			void this.plugin.saveSettings(true);
		});
		showError();

		const recovery = card.createDiv({ cls: 'meld-pattern-recovery' });
		const originalMode = recovery.createEl('select', { cls: 'dropdown' });
		originalMode.createEl('option', { text: 'Capture groups', value: 'capture' });
		originalMode.createEl('option', { text: 'Replace basename', value: 'replace' });
		originalMode.value = pattern.originalMode;
		originalMode.addEventListener('change', () => {
			pattern.originalMode = originalMode.value === 'replace' ? 'replace' : 'capture';
			void this.plugin.saveSettings(true);
		});
		const rewrite = recovery.createEl('input', {
			type: 'text',
			cls: 'meld-input',
			value: pattern.originalRewrite ?? '',
			placeholder: '$dir$stem$ext',
		});
		rewrite.addEventListener('change', () => {
			pattern.originalRewrite = rewrite.value;
			void this.plugin.saveSettings(true);
		});

		const ignores = card.createEl('input', {
			type: 'text',
			cls: 'meld-input',
			value: (pattern.ignoreGlobs ?? []).join(', '),
			placeholder: 'Extra ignore globs, comma separated',
		});
		ignores.addEventListener('change', () => {
			pattern.ignoreGlobs = ignores.value.split(',').map((part) => part.trim()).filter(Boolean);
			void this.plugin.saveSettings(true);
		});

		const testRow = card.createDiv({ cls: 'meld-test-row' });
		const sample = testRow.createEl('input', { type: 'text', cls: 'meld-input', placeholder: 'Test against a vault path' });
		const result = card.createDiv({ cls: 'meld-test-result' });
		const run = testRow.createEl('button', { text: 'Test' });
		const runTest = () => {
			pattern.expression = expression.value;
			const exists = new Set(this.app.vault.getFiles().map((file) => file.path));
			const explained = explainPattern(pattern, sample.value.trim(), (candidate) => exists.has(candidate));
			if (explained.error) {
				result.setText(explained.error);
				return;
			}
			if (!explained.matched) {
				result.setText('No match');
				return;
			}
			const bits = [
				`Original: ${explained.originalPath || '(none)'}`,
				explained.originalExists ? 'found in the vault' : 'not in the vault',
			];
			if (explained.date) bits.push(`date ${explained.date}`);
			if (explained.time) bits.push(`time ${explained.time}`);
			if (explained.modifiedBy) bits.push(`device ${explained.modifiedBy}`);
			result.setText(bits.join(' · '));
		};
		run.addEventListener('click', runTest);
		sample.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				runTest();
			}
		});
	}

	private smallButton(parent: HTMLElement, text: string, action: () => void): void {
		const button = parent.createEl('button', { text });
		button.addEventListener('click', action);
	}

	private move(index: number, delta: number): void {
		const next = index + delta;
		const patterns = this.plugin.settings.patterns;
		const current = patterns[index];
		const swap = patterns[next];
		if (!current || !swap) return;
		patterns[index] = swap;
		patterns[next] = current;
		void this.plugin.saveSettings(true);
		this.display();
	}
}

function clamp(value: number, min: number, max: number, fallback: number): number {
	if (!Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, value));
}
