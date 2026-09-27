export interface ConflictPattern {
	id: string;
	enabled: boolean;
	name: string;
	mode: 'regex' | 'glob';
	expression: string;
	/** "capture" substitutes named groups. "replace" runs the rewrite against the basename. */
	originalMode: 'capture' | 'replace';
	originalRewrite?: string;
	ignoreGlobs?: string[];
}

export interface ConflictFile {
	path: string;
	patternId: string;
	date?: string;
	time?: string;
	modifiedBy?: string;
	mtime: number;
	size: number;
}

export interface ConflictGroup {
	originalPath: string;
	originalExists: boolean;
	conflicts: ConflictFile[];
}

export interface MeldDiffSettings {
	patterns: ConflictPattern[];
	ignoreGlobs: string[];
	includeUnrecognizedExtensions: boolean;
	scanOnStartup: boolean;
	statusBarEnabled: boolean;
	ribbonEnabled: boolean;
	collapseUnchanged: boolean;
	collapseMargin: number;
	scanLimit: number;
	autosave: boolean;
	autosaveMs: number;
	defaultLeftIsOriginal: boolean;
	alignScroll: boolean;
	showCurrentLine: boolean;
	showLineNumbers: boolean;
	showWhitespace: boolean;
	wrapLines: boolean;
	showIntraLine: boolean;
	ribbonConflicts: boolean;
	ribbonDiff: boolean;
}

export interface DiffViewState {
	leftPath: string | null;
	rightPath: string | null;
}

export interface ConflictViewState {
	collapsedFolders?: string[];
	collapsedOriginals?: string[];
	query?: string;
	scrollTop?: number;
}

export interface VaultFileInfo {
	path: string;
	mtime: number;
	size: number;
}
