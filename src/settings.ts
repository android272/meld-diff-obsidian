import {
	BLOCK_OPACITY_DEFAULT,
	BLOCK_OPACITY_MAX,
	BLOCK_OPACITY_MIN,
	normalizeHex,
	quantizeOpacity,
	TOKEN_OPACITY_DEFAULT,
	TOKEN_OPACITY_MAX,
	TOKEN_OPACITY_MIN,
} from './diff/hunk-colors';
import type { ConflictPattern, MeldDiffSettings } from './types';

export const SYNCTHING_EXPRESSION = String.raw`^(?<dir>.*/)?(?<stem>[^/]+?)\.sync-conflict-(?<date>\d{8})-(?<time>\d{6})-(?<modifiedBy>[A-Za-z0-9]+)(?<ext>\.[^./]+)$`;

export const OBSIDIAN_SYNC_EXPRESSION = String.raw`^(?<dir>.*/)?(?<stem>[^/]+?)\.sync-conflict-(?<date>\d{8})-(?<time>\d{6})(?<ext>\.[^./]+)$`;

export const NEXTCLOUD_GLOB = '**/* (conflicted copy *).*';

export const DEFAULT_IGNORE_GLOBS = [
	'.obsidian/**',
	'.trash/**',
	'**/.git/**',
	'**/.stfolder/**',
	'**/.stversions/**',
];

export function newId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
	return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function syncthingPreset(id = 'preset-syncthing'): ConflictPattern {
	return {
		id,
		enabled: true,
		name: 'Syncthing',
		mode: 'regex',
		expression: SYNCTHING_EXPRESSION,
		originalMode: 'capture',
		originalRewrite: '$dir$stem$ext',
	};
}

export function obsidianSyncPreset(id = 'preset-obsidian-sync'): ConflictPattern {
	return {
		id,
		enabled: false,
		name: 'Obsidian Sync',
		mode: 'regex',
		expression: OBSIDIAN_SYNC_EXPRESSION,
		originalMode: 'capture',
		originalRewrite: '$dir$stem$ext',
	};
}

export function nextcloudPreset(id = 'preset-nextcloud'): ConflictPattern {
	return {
		id,
		enabled: false,
		name: 'Nextcloud',
		mode: 'glob',
		expression: NEXTCLOUD_GLOB,
		originalMode: 'replace',
	};
}

export function blankPreset(): ConflictPattern {
	return {
		id: newId(),
		enabled: true,
		name: 'Custom',
		mode: 'regex',
		expression: '',
		originalMode: 'capture',
		originalRewrite: '$dir$stem$ext',
	};
}

export function defaultPatterns(): ConflictPattern[] {
	return [syncthingPreset(), obsidianSyncPreset(), nextcloudPreset()];
}

export const DEFAULT_SETTINGS: MeldDiffSettings = {
	patterns: defaultPatterns(),
	ignoreGlobs: [...DEFAULT_IGNORE_GLOBS],
	includeUnrecognizedExtensions: true,
	scanOnStartup: true,
	statusBarEnabled: true,
	ribbonEnabled: true,
	collapseUnchanged: false,
	collapseMargin: 3,
	scanLimit: 10000,
	autosave: false,
	autosaveMs: 750,
	defaultLeftIsOriginal: true,
	alignScroll: true,
	showCurrentLine: true,
	showLineNumbers: true,
	showWhitespace: false,
	wrapLines: true,
	showIntraLine: true,
	ribbonConflicts: true,
	ribbonDiff: true,
	colorSource: 'theme',
	hunkDelete: '',
	hunkInsert: '',
	hunkChange: '',
	hunkToken: '',
	hunkOpacity: BLOCK_OPACITY_DEFAULT,
	tokenOpacity: TOKEN_OPACITY_DEFAULT,
};

function asBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function asNumber(value: unknown, fallback: number, min: number, max: number): number {
	const number = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(number)) return fallback;
	return Math.min(max, Math.max(min, number));
}

function normalizePattern(value: unknown): ConflictPattern | null {
	if (!value || typeof value !== 'object') return null;
	const raw = value as Partial<ConflictPattern>;
	const mode = raw.mode === 'glob' ? 'glob' : 'regex';
	const originalMode = raw.originalMode === 'replace' ? 'replace' : 'capture';
	const ignore = Array.isArray(raw.ignoreGlobs) ? raw.ignoreGlobs.filter((item): item is string => typeof item === 'string') : undefined;
	return {
		id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
		enabled: raw.enabled !== false,
		name: typeof raw.name === 'string' ? raw.name : 'Pattern',
		mode,
		expression: typeof raw.expression === 'string' ? raw.expression : '',
		originalMode,
		originalRewrite: typeof raw.originalRewrite === 'string' ? raw.originalRewrite : undefined,
		ignoreGlobs: ignore,
	};
}

export function mergeSettings(raw: unknown): MeldDiffSettings {
	const input = raw && typeof raw === 'object' ? (raw as Partial<MeldDiffSettings>) : {};
	const patterns = Array.isArray(input.patterns)
		? input.patterns.map(normalizePattern).filter((item): item is ConflictPattern => item !== null)
		: defaultPatterns();
	const ignoreGlobs = Array.isArray(input.ignoreGlobs)
		? input.ignoreGlobs.filter((item): item is string => typeof item === 'string')
		: [...DEFAULT_IGNORE_GLOBS];
	return {
		patterns,
		ignoreGlobs,
		includeUnrecognizedExtensions: asBoolean(input.includeUnrecognizedExtensions, DEFAULT_SETTINGS.includeUnrecognizedExtensions),
		scanOnStartup: asBoolean(input.scanOnStartup, DEFAULT_SETTINGS.scanOnStartup),
		statusBarEnabled: asBoolean(input.statusBarEnabled, DEFAULT_SETTINGS.statusBarEnabled),
		ribbonEnabled: asBoolean(input.ribbonEnabled, DEFAULT_SETTINGS.ribbonEnabled),
		collapseUnchanged: asBoolean(input.collapseUnchanged, DEFAULT_SETTINGS.collapseUnchanged),
		collapseMargin: asNumber(input.collapseMargin, DEFAULT_SETTINGS.collapseMargin, 0, 50),
		scanLimit: asNumber(input.scanLimit, DEFAULT_SETTINGS.scanLimit, 100, 500000),
		autosave: asBoolean(input.autosave, DEFAULT_SETTINGS.autosave),
		autosaveMs: asNumber(input.autosaveMs, DEFAULT_SETTINGS.autosaveMs, 100, 60000),
		defaultLeftIsOriginal: asBoolean(input.defaultLeftIsOriginal, DEFAULT_SETTINGS.defaultLeftIsOriginal),
		alignScroll: asBoolean(input.alignScroll, DEFAULT_SETTINGS.alignScroll),
		showCurrentLine: asBoolean(input.showCurrentLine, DEFAULT_SETTINGS.showCurrentLine),
		showLineNumbers: asBoolean(input.showLineNumbers, DEFAULT_SETTINGS.showLineNumbers),
		showWhitespace: asBoolean(input.showWhitespace, DEFAULT_SETTINGS.showWhitespace),
		wrapLines: asBoolean(input.wrapLines, DEFAULT_SETTINGS.wrapLines),
		showIntraLine: asBoolean(input.showIntraLine, DEFAULT_SETTINGS.showIntraLine),
		ribbonConflicts: asBoolean(input.ribbonConflicts, DEFAULT_SETTINGS.ribbonConflicts),
		ribbonDiff: asBoolean(input.ribbonDiff, DEFAULT_SETTINGS.ribbonDiff),
		colorSource: input.colorSource === 'custom' ? 'custom' : 'theme',
		hunkDelete: normalizeHex(input.hunkDelete),
		hunkInsert: normalizeHex(input.hunkInsert),
		hunkChange: normalizeHex(input.hunkChange),
		hunkToken: normalizeHex(input.hunkToken),
		hunkOpacity: quantizeOpacity(asNumber(input.hunkOpacity, DEFAULT_SETTINGS.hunkOpacity, BLOCK_OPACITY_MIN, BLOCK_OPACITY_MAX)),
		tokenOpacity: quantizeOpacity(asNumber(input.tokenOpacity, DEFAULT_SETTINGS.tokenOpacity, TOKEN_OPACITY_MIN, TOKEN_OPACITY_MAX)),
	};
}
