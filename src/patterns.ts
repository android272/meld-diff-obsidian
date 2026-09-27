import type { ConflictPattern } from './types';
import { fileName, parentPath } from './text-util';

export function normalizeVaultPath(path: string): string {
	let next = path.replace(/\\/g, '/').trim();
	if (next.startsWith('./')) next = next.slice(2);
	next = next.replace(/^\/+/, '');
	next = next.replace(/\/{2,}/g, '/');
	if (next.endsWith('/')) next = next.slice(0, -1);
	return next;
}

export function globToRegExp(glob: string): RegExp {
	let src = '';
	for (let i = 0; i < glob.length; i++) {
		const ch = glob[i];
		if (ch === '*') {
			if (glob[i + 1] === '*') {
				i++;
				if (glob[i + 1] === '/') {
					src += '(?:.*/)?';
					i++;
				} else {
					src += '.*';
				}
			} else {
				src += '[^/]*';
			}
			continue;
		}
		if (ch === '?') {
			src += '[^/]';
			continue;
		}
		if (ch && '\\^$+?.()|{}[]'.includes(ch)) src += `\\${ch}`;
		else src += ch ?? '';
	}
	return new RegExp(`^${src}$`);
}

export function compileIgnore(globs: readonly string[]): RegExp[] {
	const out: RegExp[] = [];
	for (const glob of globs) {
		const trimmed = glob.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		try {
			out.push(globToRegExp(trimmed));
		} catch (error) {
			console.error('Meld Diff: bad ignore glob', trimmed, error);
		}
	}
	return out;
}

export function pathIgnored(path: string, regs: readonly RegExp[]): boolean {
	if (regs.length === 0) return false;
	const norm = normalizeVaultPath(path);
	return regs.some((re) => re.test(norm));
}

export interface CompiledPattern {
	pattern: ConflictPattern;
	regex: RegExp;
	ignores: RegExp[];
}

export function compilePattern(pattern: ConflictPattern): { ok: true; compiled: CompiledPattern } | { ok: false; error: string } {
	const expression = pattern.expression.trim();
	if (!expression) return { ok: false, error: 'Expression is empty' };
	try {
		const regex = pattern.mode === 'glob' ? globToRegExp(expression) : new RegExp(expression);
		return {
			ok: true,
			compiled: {
				pattern,
				regex,
				ignores: compileIgnore(pattern.ignoreGlobs ?? []),
			},
		};
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : 'Invalid pattern' };
	}
}

export function preparePatterns(patterns: readonly ConflictPattern[]): { compiled: CompiledPattern[]; invalid: ConflictPattern[] } {
	const compiled: CompiledPattern[] = [];
	const invalid: ConflictPattern[] = [];
	for (const pattern of patterns) {
		if (!pattern.enabled) continue;
		const result = compilePattern(pattern);
		if (result.ok) compiled.push(result.compiled);
		else invalid.push(pattern);
	}
	return { compiled, invalid };
}

export function patternHealth(patterns: readonly ConflictPattern[]): { enabled: number; valid: number; invalid: number } {
	let enabled = 0;
	let valid = 0;
	let invalid = 0;
	for (const pattern of patterns) {
		if (!pattern.enabled) continue;
		enabled++;
		const result = compilePattern(pattern);
		if (result.ok) valid++;
		else invalid++;
	}
	return { enabled, valid, invalid };
}

function groupsOf(match: RegExpMatchArray): Record<string, string> {
	const groups: Record<string, string> = {};
	for (const [key, value] of Object.entries(match.groups ?? {})) {
		if (typeof value === 'string') groups[key] = value;
	}
	return groups;
}

function subst(template: string, groups: Record<string, string>): string {
	return template.replace(/\$(\w+)/g, (_all, name: string) => groups[name] ?? '');
}

export function stripSyncConflict(path: string): string {
	const norm = normalizeVaultPath(path);
	const slash = norm.lastIndexOf('/');
	const dir = slash >= 0 ? norm.slice(0, slash + 1) : '';
	const base = slash >= 0 ? norm.slice(slash + 1) : norm;
	const next = base.replace(/\.sync-conflict-\d{8}-\d{6}(?:-[A-Za-z0-9]+)?/, '');
	return normalizeVaultPath(dir + next);
}

export function recoverGlobOriginal(path: string): string | null {
	const norm = normalizeVaultPath(path);
	const slash = norm.lastIndexOf('/');
	const dir = slash >= 0 ? norm.slice(0, slash + 1) : '';
	const base = slash >= 0 ? norm.slice(slash + 1) : norm;
	const conflicted = base.replace(/ \(conflicted copy [^)]*\)/, '');
	if (conflicted !== base) return normalizeVaultPath(dir + conflicted);
	const sync = base.replace(/\.sync-conflict-\d{8}-\d{6}(?:-[A-Za-z0-9]+)?/, '');
	if (sync !== base) return normalizeVaultPath(dir + sync);
	return null;
}

function dedupeCandidates(paths: readonly string[], self: string): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	const own = normalizeVaultPath(self);
	for (const raw of paths) {
		const path = normalizeVaultPath(raw);
		if (!path || path === own || seen.has(path)) continue;
		seen.add(path);
		out.push(path);
	}
	return out;
}

function regexGroups(compiled: CompiledPattern, path: string): Record<string, string> | null {
	const full = path.match(compiled.regex);
	if (full) return groupsOf(full);
	const base = fileName(path);
	if (!base || base === path) return null;
	const partial = base.match(compiled.regex);
	if (!partial) return null;
	const groups = groupsOf(partial);
	if (!groups.dir) {
		const parent = parentPath(path);
		if (parent) groups.dir = `${parent}/`;
	}
	return groups;
}

export function candidatesFor(compiled: CompiledPattern, path: string): { groups: Record<string, string>; candidates: string[] } | null {
	const norm = normalizeVaultPath(path);
	if (pathIgnored(norm, compiled.ignores)) return null;
	if (compiled.pattern.mode === 'glob') {
		if (!compiled.regex.test(norm) && !compiled.regex.test(fileName(norm))) return null;
		const recovered = recoverGlobOriginal(norm);
		return { groups: {}, candidates: dedupeCandidates(recovered ? [recovered] : [], norm) };
	}
	const groups = regexGroups(compiled, norm);
	if (!groups) return null;
	const raw: string[] = [];
	if (groups.original) {
		const dir = groups.dir ?? '';
		raw.push(groups.original.includes('/') ? groups.original : dir + groups.original);
	}
	const rewrite = compiled.pattern.originalRewrite;
	if (rewrite) {
		if (compiled.pattern.originalMode === 'replace') {
			const base = fileName(norm);
			const replaced = base.replace(compiled.regex, rewrite);
			if (replaced && replaced !== base) {
				const parent = parentPath(norm);
				raw.push(parent ? `${parent}/${replaced}` : replaced);
			}
		}
		raw.push(subst(rewrite, groups));
	}
	raw.push(subst('$dir$stem$ext', groups));
	raw.push(subst('$dir$stem', groups));
	raw.push(stripSyncConflict(norm));
	return { groups, candidates: dedupeCandidates(raw, norm) };
}

export function pickOriginal(candidates: readonly string[], exists: (path: string) => boolean): { path: string; exists: boolean } {
	for (const candidate of candidates) {
		if (exists(candidate)) return { path: candidate, exists: true };
	}
	const first = candidates[0];
	if (first) return { path: first, exists: false };
	return { path: '', exists: false };
}

export interface PathMatch {
	patternId: string;
	groups: Record<string, string>;
	candidates: string[];
	originalPath: string;
	originalExists: boolean;
}

export function matchConflictPath(
	path: string,
	patterns: readonly ConflictPattern[],
	exists: (path: string) => boolean = () => false,
): PathMatch | null {
	const { compiled } = preparePatterns(patterns);
	return matchPrepared(path, compiled, exists);
}

export function matchPrepared(
	path: string,
	compiled: readonly CompiledPattern[],
	exists: (path: string) => boolean = () => false,
): PathMatch | null {
	for (const item of compiled) {
		const found = candidatesFor(item, path);
		if (!found) continue;
		const picked = pickOriginal(found.candidates, exists);
		return {
			patternId: item.pattern.id,
			groups: found.groups,
			candidates: found.candidates,
			originalPath: picked.path,
			originalExists: picked.exists,
		};
	}
	return null;
}

export interface PatternExplanation {
	error?: string;
	matched: boolean;
	originalPath?: string;
	originalExists?: boolean;
	date?: string;
	time?: string;
	modifiedBy?: string;
	candidates: string[];
}

export function explainPattern(pattern: ConflictPattern, path: string, exists: (candidate: string) => boolean): PatternExplanation {
	const compiled = compilePattern(pattern);
	if (!compiled.ok) return { error: compiled.error, matched: false, candidates: [] };
	const found = candidatesFor(compiled.compiled, path);
	if (!found) return { matched: false, candidates: [] };
	const picked = pickOriginal(found.candidates, exists);
	return {
		matched: true,
		originalPath: picked.path,
		originalExists: picked.exists,
		date: found.groups.date,
		time: found.groups.time,
		modifiedBy: found.groups.modifiedBy,
		candidates: found.candidates,
	};
}
