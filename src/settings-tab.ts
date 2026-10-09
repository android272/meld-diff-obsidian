import { PluginSettingTab, Setting, type App, type SettingDefinitionItem, type SettingDefinitionPage, type SettingGroupItem } from 'obsidian';
import {
	BLOCK_OPACITY_DEFAULT,
	BLOCK_OPACITY_MAX,
	BLOCK_OPACITY_MIN,
	HUNK_COLOR_SEEDS,
	normalizeHex,
	quantizeOpacity,
	themeSwatch,
	TOKEN_OPACITY_DEFAULT,
	TOKEN_OPACITY_MAX,
	TOKEN_OPACITY_MIN,
	type HunkColorSlot,
} from './diff/hunk-colors';
import type MeldDiffPlugin from './main';
import { explainPattern, type PatternExplanation } from './patterns';
import { blankPreset, newId, nextcloudPreset, obsidianSyncPreset, syncthingPreset } from './settings';
import type { ConflictPattern, MeldDiffSettings } from './types';

export class MeldDiffSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: MeldDiffPlugin) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const settings = this.plugin.settings;
		const color = (name: string, desc: string, key: ColorKey): SettingGroupItem => ({
			name,
			desc,
			visible: () => this.plugin.settings.colorSource === 'custom',
			control: { type: 'color', key, defaultValue: HUNK_COLOR_SEEDS[COLOR_SLOT[key]] },
		});
		return [
			{
				name: 'Conflict patterns',
				desc: 'Meld Diff finds sync conflict files and opens them in a split source editor. Patterns run in order. The first match picks the original path.',
			},
			{
				name: 'Add a pattern',
				desc: 'Start from a preset or a blank expression.',
				render: (setting) => {
					setting.addButton((button) => button.setButtonText('Syncthing').onClick(() => this.addPattern(syncthingPreset(newId()))));
					setting.addButton((button) => button.setButtonText('Obsidian Sync').onClick(() => this.addPattern(obsidianSyncPreset(newId()))));
					setting.addButton((button) => button.setButtonText('Nextcloud').onClick(() => this.addPattern(nextcloudPreset(newId()))));
					setting.addButton((button) => button.setButtonText('Blank').onClick(() => this.addPattern(blankPreset())));
				},
			},
			{
				type: 'list',
				heading: 'Patterns',
				emptyState: 'No patterns yet.',
				onReorder: (from, to) => this.reorderPattern(from, to),
				onDelete: (index) => this.deletePattern(index),
				items: settings.patterns.map((pattern) => this.patternPage(pattern)),
			},
			{
				name: 'Ignore globs',
				desc: 'One glob per line. Files under these paths are never conflicts or originals. The configuration folder is always skipped. * and ** both work.',
				control: { type: 'textarea', key: 'ignoreGlobs', rows: 6 },
			},
			{
				name: 'Include unrecognized extensions',
				desc: 'Also scan names Obsidian does not index, so a conflicted image still shows up in the list.',
				control: { type: 'toggle', key: 'includeUnrecognizedExtensions' },
			},
			{
				name: 'Scan on startup',
				control: { type: 'toggle', key: 'scanOnStartup' },
			},
			{
				name: 'Rescan now',
				action: () => this.plugin.rescan(),
			},
			{
				type: 'group',
				heading: 'Appearance',
				items: [
					{
						name: 'Status bar',
						desc: 'Show the conflict count. Click it to open Conflict View.',
						control: { type: 'toggle', key: 'statusBarEnabled' },
					},
					{
						name: 'Ribbon icons',
						desc: 'Master switch for both left-ribbon buttons.',
						control: { type: 'toggle', key: 'ribbonEnabled' },
					},
					{
						name: 'Conflicts ribbon button',
						visible: () => this.plugin.settings.ribbonEnabled,
						control: { type: 'toggle', key: 'ribbonConflicts' },
					},
					{
						name: 'Diff ribbon button',
						visible: () => this.plugin.settings.ribbonEnabled,
						control: { type: 'toggle', key: 'ribbonDiff' },
					},
					{
						name: 'Original on A',
						desc: 'On: a conflict opens with the original on A and the conflict on B. A is the left pane on desktop and the top pane on mobile. Off: the original opens on B, the right pane on desktop and the bottom pane on mobile, and the conflict opens on A. Changing this swaps the two sides of an open diff immediately. Swap can still flip that pair afterward.',
						control: { type: 'toggle', key: 'defaultLeftIsOriginal' },
					},
				],
			},
			{
				type: 'group',
				heading: 'Diff display',
				items: [
					{
						name: 'Force mobile layout',
						desc: 'Stack the diff the way it appears on a phone, so you can check that layout on the desktop. A phone always uses the stacked layout.',
						control: { type: 'toggle', key: 'forceMobileLayout' },
					},
					{
						name: 'Align scroll',
						desc: 'Keep both sides scrolled together.',
						control: { type: 'toggle', key: 'alignScroll' },
					},
					{
						name: 'Show current line',
						desc: 'Highlight the line the cursor is on.',
						control: { type: 'toggle', key: 'showCurrentLine' },
					},
					{
						name: 'Show line numbers',
						control: { type: 'toggle', key: 'showLineNumbers' },
					},
					{
						name: 'Show whitespace',
						desc: 'Changed lines always show spaces, tabs, and line endings. Turn this on to draw them in the rest of the file too. Nothing extra is saved.',
						control: { type: 'toggle', key: 'showWhitespace' },
					},
					{
						name: 'Text wrapping',
						control: { type: 'toggle', key: 'wrapLines' },
					},
					{
						name: 'Highlight changes inside a line',
						desc: 'Color the characters that differ when both sides have text. Lines that exist on only one side stay unmarked.',
						control: { type: 'toggle', key: 'showIntraLine' },
					},
					{
						name: 'Collapse unchanged regions',
						control: { type: 'toggle', key: 'collapseUnchanged' },
					},
					{
						name: 'Unchanged lines to keep',
						desc: 'How many unchanged lines stay visible around a change when collapsing is on.',
						control: { type: 'number', key: 'collapseMargin', min: 0, max: 50, step: 1, defaultValue: 3 },
					},
				],
			},
			{
				type: 'group',
				heading: 'Diff colors',
				items: [
					{
						name: 'Color source',
						desc: 'Red is a deletion, green is an addition, yellow is a change on both sides, and orange marks the characters that differ. Theme follows the active theme. Custom uses one hex in light and dark. Style Settings writes these same colors, and the last change is saved here.',
						control: {
							type: 'dropdown',
							key: 'colorSource',
							options: { theme: 'Theme colors', custom: 'Custom colors' },
						},
					},
					color('Deleted (A only)', 'Lines that exist only on A, and their wave.', 'hunkDelete'),
					color('Added (B only)', 'Lines that exist only on B, and their wave.', 'hunkInsert'),
					color('Changed (both sides)', 'Both sides, and the wave between them.', 'hunkChange'),
					color('Changed characters', 'Characters that differ inside a change. Ignored when highlighting inside a line is off.', 'hunkToken'),
					{
						name: 'Block opacity (%)',
						desc: 'Wash behind a whole hunk and its wave.',
						control: {
							type: 'slider',
							key: 'hunkOpacity',
							min: BLOCK_OPACITY_MIN,
							max: BLOCK_OPACITY_MAX,
							step: 0.01,
							displayFormat: (value) => `${Math.round(value * 100)}%`,
						},
					},
					{
						name: 'Character opacity (%)',
						desc: 'Wash on characters that differ. Ignored when highlighting inside a line is off.',
						control: {
							type: 'slider',
							key: 'tokenOpacity',
							min: TOKEN_OPACITY_MIN,
							max: TOKEN_OPACITY_MAX,
							step: 0.01,
							displayFormat: (value) => `${Math.round(value * 100)}%`,
						},
					},
					{
						name: 'Reset colors',
						desc: 'Use theme colors again and restore the default opacities.',
						action: () => {
							settings.colorSource = 'theme';
							settings.hunkOpacity = BLOCK_OPACITY_DEFAULT;
							settings.tokenOpacity = TOKEN_OPACITY_DEFAULT;
							void this.plugin.saveSettings(false, true);
							this.update();
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Saving',
				items: [
					{
						name: 'Autosave after edits',
						desc: 'On by default. 750 ms after you stop typing, saves a side that already has a note. Text with no note is kept until you save it as a note.',
						control: { type: 'toggle', key: 'autosave' },
					},
					{
						name: 'Autosave delay (ms)',
						visible: () => this.plugin.settings.autosave,
						control: { type: 'number', key: 'autosaveMs', min: 100, max: 60000, step: 1, defaultValue: 750 },
					},
				],
			},
			{
				type: 'group',
				heading: 'Advanced',
				items: [
					{
						name: 'Diff scan limit',
						desc: 'Maximum characters compared precisely inside one changed region. Higher is more accurate and slower.',
						control: { type: 'number', key: 'scanLimit', min: 100, max: 500000, step: 1, defaultValue: 10000 },
					},
				],
			},
		];
	}

	getControlValue(key: string): unknown {
		const settings = this.plugin.settings;
		if (key === 'ignoreGlobs') return settings.ignoreGlobs.join('\n');
		const pattern = this.patternField(key);
		if (pattern) return this.readPatternField(pattern.pattern, pattern.field);
		if (isColorKey(key)) return settings[key] || this.swatch(COLOR_SLOT[key]);
		return settings[key as keyof typeof settings];
	}

	setControlValue(key: string, value: unknown): void {
		const settings = this.plugin.settings;
		let rescan = false;
		let colors = false;
		if (key === 'ignoreGlobs') {
			settings.ignoreGlobs = String(value).split('\n').map((line) => line.trim()).filter(Boolean);
			rescan = true;
		} else if (key === 'includeUnrecognizedExtensions') {
			settings.includeUnrecognizedExtensions = Boolean(value);
			rescan = true;
		} else if (key === 'colorSource') {
			settings.colorSource = value === 'custom' ? 'custom' : 'theme';
			if (settings.colorSource === 'custom') this.ensureCustomColors();
			colors = true;
		} else if (isColorKey(key)) {
			settings[key] = normalizeHex(value) || settings[key] || this.swatch(COLOR_SLOT[key]);
			settings.colorSource = 'custom';
			this.ensureCustomColors();
			colors = true;
		} else if (key === 'hunkOpacity') {
			settings.hunkOpacity = quantizeOpacity(clamp(Number(value), BLOCK_OPACITY_MIN, BLOCK_OPACITY_MAX, settings.hunkOpacity));
			colors = true;
		} else if (key === 'tokenOpacity') {
			settings.tokenOpacity = quantizeOpacity(clamp(Number(value), TOKEN_OPACITY_MIN, TOKEN_OPACITY_MAX, settings.tokenOpacity));
			colors = true;
		} else if (key === 'collapseMargin') {
			settings.collapseMargin = clamp(Number(value), 0, 50, settings.collapseMargin);
		} else if (key === 'autosaveMs') {
			settings.autosaveMs = clamp(Number(value), 100, 60000, settings.autosaveMs);
		} else if (key === 'scanLimit') {
			settings.scanLimit = clamp(Number(value), 100, 500000, settings.scanLimit);
		} else {
			const pattern = this.patternField(key);
			if (pattern) rescan = this.writePatternField(pattern.pattern, pattern.field, value);
			else if (isSettingsKey(settings, key)) settings[key] = value as never;
		}
		void this.plugin.saveSettings(rescan, colors);
	}

	private ensureCustomColors(): void {
		const settings = this.plugin.settings;
		const doc = this.containerEl.ownerDocument;
		const fill = (key: 'hunkDelete' | 'hunkInsert' | 'hunkChange' | 'hunkToken', slot: HunkColorSlot) => {
			if (!settings[key]) settings[key] = themeSwatch(doc, slot);
		};
		fill('hunkDelete', 'delete');
		fill('hunkInsert', 'insert');
		fill('hunkChange', 'change');
		fill('hunkToken', 'token');
	}

	private patternPage(pattern: ConflictPattern): SettingDefinitionPage {
		return {
			type: 'page',
			name: pattern.name || 'Pattern',
			desc: patternDesc(pattern),
			status: () => patternStatus(pattern),
			items: [
				{ name: 'Name', control: { type: 'text', key: patternKey(pattern.id, 'name') } },
				{
					name: 'Enabled',
					desc: 'Disabled patterns are skipped.',
					control: { type: 'toggle', key: patternKey(pattern.id, 'enabled') },
				},
				{
					name: 'Match',
					control: {
						type: 'dropdown',
						key: patternKey(pattern.id, 'mode'),
						options: { regex: 'Regex', glob: 'Glob' },
					},
				},
				{
					name: 'Expression',
					desc: 'The first matching pattern picks the original path.',
					control: {
						type: 'textarea',
						key: patternKey(pattern.id, 'expression'),
						placeholder: pattern.mode === 'glob' ? '**/* (conflicted copy *).*' : 'Regular expression',
					},
				},
				{
					name: 'Original path',
					control: {
						type: 'dropdown',
						key: patternKey(pattern.id, 'originalMode'),
						options: { capture: 'Capture groups', replace: 'Replace basename' },
					},
				},
				{
					name: 'Rewrite',
					desc: 'Capture groups use $dir, $stem, and $ext. Replace runs against the basename.',
					control: { type: 'text', key: patternKey(pattern.id, 'originalRewrite'), placeholder: '$dir$stem$ext' },
				},
				{
					name: 'Extra ignore globs',
					desc: 'Comma separated. These paths are skipped for this pattern only.',
					control: { type: 'text', key: patternKey(pattern.id, 'ignoreGlobs'), placeholder: 'Comma separated' },
				},
				{
					name: 'Test a path',
					desc: 'Check a vault path against this pattern.',
					render: (setting) => this.renderPatternTest(setting, pattern.id),
				},
			],
		};
	}

	private renderPatternTest(setting: Setting, id: string): void {
		let sample = '';
		setting.addText((text) => text.setPlaceholder('Vault path').onChange((value) => {
			sample = value;
		}));
		setting.addButton((button) => button.setButtonText('Test').onClick(() => {
			const pattern = this.plugin.settings.patterns.find((item) => item.id === id);
			if (!pattern) return;
			const exists = new Set(this.app.vault.getFiles().map((file) => file.path));
			setting.setDesc(testMessage(explainPattern(pattern, sample.trim(), (candidate) => exists.has(candidate))));
		}));
	}

	private addPattern(pattern: ConflictPattern): void {
		this.plugin.settings.patterns.push(pattern);
		void this.plugin.saveSettings(true);
		this.update();
	}

	private deletePattern(index: number): void {
		this.plugin.settings.patterns.splice(index, 1);
		void this.plugin.saveSettings(true);
		this.update();
	}

	private reorderPattern(from: number, to: number): void {
		const patterns = this.plugin.settings.patterns;
		const [item] = patterns.splice(from, 1);
		if (!item) return;
		patterns.splice(to, 0, item);
		void this.plugin.saveSettings(true);
		this.update();
	}

	private patternField(key: string): { pattern: ConflictPattern; field: PatternField } | null {
		const match = /^pattern\.([^.]+)\.(name|enabled|mode|expression|originalMode|originalRewrite|ignoreGlobs)$/.exec(key);
		const id = match?.[1];
		const field = match?.[2];
		if (!id || !isPatternField(field)) return null;
		const pattern = this.plugin.settings.patterns.find((item) => item.id === id);
		return pattern ? { pattern, field } : null;
	}

	private readPatternField(pattern: ConflictPattern, field: PatternField): unknown {
		if (field === 'ignoreGlobs') return (pattern.ignoreGlobs ?? []).join(', ');
		if (field === 'originalRewrite') return pattern.originalRewrite ?? '';
		return pattern[field];
	}

	private writePatternField(pattern: ConflictPattern, field: PatternField, value: unknown): boolean {
		switch (field) {
			case 'name':
				pattern.name = String(value);
				return false;
			case 'enabled':
				pattern.enabled = Boolean(value);
				return true;
			case 'mode':
				pattern.mode = value === 'glob' ? 'glob' : 'regex';
				return true;
			case 'expression':
				pattern.expression = String(value);
				return true;
			case 'originalMode':
				pattern.originalMode = value === 'replace' ? 'replace' : 'capture';
				return true;
			case 'originalRewrite':
				pattern.originalRewrite = String(value);
				return true;
			case 'ignoreGlobs':
				pattern.ignoreGlobs = String(value).split(',').map((part) => part.trim()).filter(Boolean);
				return true;
		}
	}

	private swatch(slot: HunkColorSlot): string {
		return themeSwatch(this.containerEl.ownerDocument, slot);
	}

}

const COLOR_SLOT = {
	hunkDelete: 'delete',
	hunkInsert: 'insert',
	hunkChange: 'change',
	hunkToken: 'token',
} as const;

type ColorKey = keyof typeof COLOR_SLOT;

const PATTERN_FIELDS = ['name', 'enabled', 'mode', 'expression', 'originalMode', 'originalRewrite', 'ignoreGlobs'] as const;

type PatternField = (typeof PATTERN_FIELDS)[number];

function isColorKey(key: string): key is ColorKey {
	return Object.prototype.hasOwnProperty.call(COLOR_SLOT, key);
}

function isPatternField(value: string | undefined): value is PatternField {
	return PATTERN_FIELDS.includes(value as PatternField);
}

function isSettingsKey(settings: MeldDiffSettings, key: string): key is keyof MeldDiffSettings {
	return Object.prototype.hasOwnProperty.call(settings, key);
}

function patternKey(id: string, field: PatternField): string {
	return `pattern.${id}.${field}`;
}

function patternDesc(pattern: ConflictPattern): string {
	if (!pattern.enabled) return 'Disabled';
	const expression = pattern.expression.trim();
	if (!expression) return 'Expression is empty';
	return `${pattern.mode === 'glob' ? 'Glob' : 'Regex'}: ${expression}`;
}

function patternStatus(pattern: ConflictPattern): 'warning' | null {
	if (!pattern.enabled) return null;
	if (!pattern.expression.trim()) return 'warning';
	if (pattern.mode !== 'regex') return null;
	try {
		new RegExp(pattern.expression);
		return null;
	} catch {
		return 'warning';
	}
}

function testMessage(explained: PatternExplanation): string {
	if (explained.error) return explained.error;
	if (!explained.matched) return 'No match';
	const bits = [
		`Original: ${explained.originalPath || '(none)'}`,
		explained.originalExists ? 'found in the vault' : 'not in the vault',
	];
	if (explained.date) bits.push(`date ${explained.date}`);
	if (explained.time) bits.push(`time ${explained.time}`);
	if (explained.modifiedBy) bits.push(`device ${explained.modifiedBy}`);
	return bits.join(' · ');
}

function clamp(value: number, min: number, max: number, fallback: number): number {
	if (!Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, value));
}
