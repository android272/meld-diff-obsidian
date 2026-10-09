import type { MeldDiffSettings } from '../types';

export const BLOCK_OPACITY_MIN = 0.08;
export const BLOCK_OPACITY_MAX = 0.45;
export const BLOCK_OPACITY_DEFAULT = 0.2;
export const TOKEN_OPACITY_MIN = 0.2;
export const TOKEN_OPACITY_MAX = 0.6;
export const TOKEN_OPACITY_DEFAULT = 0.35;

/** Picker swatches when the theme color cannot be read. Same palette Obsidian uses for both light and dark. */
export const HUNK_COLOR_SEEDS = {
	delete: '#fb464c',
	insert: '#44cf6e',
	change: '#e0de71',
	token: '#e9973f',
} as const;

export type HunkColorSlot = keyof typeof HUNK_COLOR_SEEDS;

const THEME_COLOR: Record<HunkColorSlot, string> = {
	delete: 'var(--color-red, var(--text-error))',
	insert: 'var(--color-green, var(--text-success))',
	change: 'var(--color-yellow, var(--text-warning))',
	token: 'var(--color-orange, var(--text-warning))',
};

const THEME_PROBE: Record<HunkColorSlot, readonly string[]> = {
	delete: ['--color-red', '--text-error'],
	insert: ['--color-green', '--text-success'],
	change: ['--color-yellow', '--text-warning'],
	token: ['--color-orange', '--text-warning'],
};

const DECLARATION = /--(meld-hunk-(?:delete|insert|change|token|block-opacity|token-opacity))\s*:\s*([^;]+)\s*;/g;

export const HUNK_COLOR_STYLE_ID = 'meld-diff-hunk-colors';

export function quantizeOpacity(value: number): number {
	return Math.round(value * 100) / 100;
}

export function cssColorToHex(value: string): string | null {
	const text = value.trim();
	const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(text);
	if (hex?.[1]) return `#${hex[1]}`;
	const rgb = /^rgba?\(\s*([0-9.]+)(?:[,\s/]+)([0-9.]+)(?:[,\s/]+)([0-9.]+)/i.exec(text);
	if (!rgb?.[1] || !rgb[2] || !rgb[3]) return null;
	const channel = (raw: string) => {
		const number = Number(raw);
		if (!Number.isFinite(number)) return null;
		return Math.max(0, Math.min(255, Math.round(number))).toString(16).padStart(2, '0');
	};
	const red = channel(rgb[1]);
	const green = channel(rgb[2]);
	const blue = channel(rgb[3]);
	if (!red || !green || !blue) return null;
	return `#${red}${green}${blue}`;
}

export function normalizeHex(value: unknown): string {
	if (typeof value !== 'string') return '';
	return cssColorToHex(value.trim()) ?? '';
}

export function themeSwatch(doc: Document, slot: HunkColorSlot): string {
	const body = doc.body;
	const view = doc.defaultView;
	if (!body || !view) return HUNK_COLOR_SEEDS[slot];
	const style = view.getComputedStyle(body);
	for (const name of THEME_PROBE[slot]) {
		const hex = cssColorToHex(style.getPropertyValue(name));
		if (hex) return hex;
	}
	return HUNK_COLOR_SEEDS[slot];
}

export function hunkColorCss(settings: MeldDiffSettings): Record<string, string> {
	const custom = settings.colorSource === 'custom';
	const color = (slot: HunkColorSlot, hex: string) => (custom && hex ? hex : THEME_COLOR[slot]);
	return {
		'--meld-hunk-delete': color('delete', settings.hunkDelete),
		'--meld-hunk-insert': color('insert', settings.hunkInsert),
		'--meld-hunk-change': color('change', settings.hunkChange),
		'--meld-hunk-token': color('token', settings.hunkToken),
		'--meld-hunk-block-opacity': String(settings.hunkOpacity),
		'--meld-hunk-token-opacity': String(settings.tokenOpacity),
	};
}

export function hunkColorStyleText(settings: MeldDiffSettings): string {
	const body = Object.entries(hunkColorCss(settings)).map(([name, value]) => `${name}: ${value};`).join(' ');
	return `body, body.css-settings-manager { ${body} }`;
}

export function writeHunkColorStyle(doc: Document, settings: MeldDiffSettings): void {
	const head = doc.head;
	if (!head) return;
	let tag = doc.getElementById(HUNK_COLOR_STYLE_ID);
	if (!tag) tag = head.createEl('style', { attr: { id: HUNK_COLOR_STYLE_ID } });
	tag.textContent = hunkColorStyleText(settings);
	head.appendChild(tag);
}

export function removeHunkColorStyle(doc: Document): void {
	doc.getElementById(HUNK_COLOR_STYLE_ID)?.remove();
}

export function meldColorDeclarations(css: string): Map<string, string> {
	const out = new Map<string, string>();
	for (const match of css.matchAll(DECLARATION)) {
		const name = match[1];
		const value = match[2];
		if (name && value) out.set(name, value.trim());
	}
	return out;
}

export function sameDeclarations(left: ReadonlyMap<string, string>, right: ReadonlyMap<string, string>): boolean {
	if (left.size !== right.size) return false;
	for (const [key, value] of left) {
		if (right.get(key) !== value) return false;
	}
	return true;
}

function clampOpacity(value: number, min: number, max: number, fallback: number): number {
	if (!Number.isFinite(value)) return fallback;
	return quantizeOpacity(Math.min(max, Math.max(min, value)));
}

/**
 * Copy Style Settings edits of the hunk variables into plugin settings.
 * Only keys whose declaration changed between snapshots are touched.
 */
export function adoptHunkColorDeclarations(
	settings: MeldDiffSettings,
	previous: ReadonlyMap<string, string>,
	next: ReadonlyMap<string, string>,
): boolean {
	let changed = false;
	let colorsTouched = false;
	const color = (key: string, assign: (hex: string) => void) => {
		if (previous.get(key) === next.get(key)) return;
		changed = true;
		colorsTouched = true;
		const value = next.get(key);
		assign(value ? cssColorToHex(value) ?? '' : '');
	};
	color('meld-hunk-delete', (hex) => { settings.hunkDelete = hex; });
	color('meld-hunk-insert', (hex) => { settings.hunkInsert = hex; });
	color('meld-hunk-change', (hex) => { settings.hunkChange = hex; });
	color('meld-hunk-token', (hex) => { settings.hunkToken = hex; });
	const opacity = (key: string, assign: (value: number) => void, fallback: number, min: number, max: number) => {
		if (previous.get(key) === next.get(key)) return;
		changed = true;
		const raw = next.get(key);
		assign(raw === undefined ? fallback : clampOpacity(Number(raw), min, max, fallback));
	};
	opacity('meld-hunk-block-opacity', (value) => { settings.hunkOpacity = value; }, BLOCK_OPACITY_DEFAULT, BLOCK_OPACITY_MIN, BLOCK_OPACITY_MAX);
	opacity('meld-hunk-token-opacity', (value) => { settings.tokenOpacity = value; }, TOKEN_OPACITY_DEFAULT, TOKEN_OPACITY_MIN, TOKEN_OPACITY_MAX);
	if (!changed) return false;
	if (colorsTouched) {
		const custom = Boolean(settings.hunkDelete || settings.hunkInsert || settings.hunkChange || settings.hunkToken);
		settings.colorSource = custom ? 'custom' : 'theme';
	}
	return true;
}
