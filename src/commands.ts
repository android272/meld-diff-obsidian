import { TFile } from 'obsidian';
import { pickVaultFile } from './diff/file-suggest';
import { parentPath } from './text-util';
import type { Placement } from './workspace';
import type MeldDiffPlugin from './main';

export function registerCommands(plugin: MeldDiffPlugin): void {
	const openConflict = (placement: Placement) => {
		plugin.addCommand({
			id: conflictId(placement),
			name: conflictName(placement),
			hotkeys: [],
			callback: () => { void plugin.openView('conflict', placement); },
		});
	};
	openConflict('reveal');
	openConflict('tab');
	openConflict('left');
	openConflict('right');
	openConflict('toggle');

	const openDiff = (placement: Placement) => {
		plugin.addCommand({
			id: diffId(placement),
			name: diffName(placement),
			hotkeys: [],
			callback: () => { void plugin.openView('diff', placement); },
		});
	};
	openDiff('reveal');
	openDiff('tab');
	openDiff('left');
	openDiff('right');
	openDiff('toggle');

	plugin.addCommand({
		id: 'diff-current-with-other',
		name: 'Meld Diff: Compare current file with…',
		hotkeys: [],
		checkCallback: (checking) => {
			const file = plugin.app.workspace.getActiveFile();
			if (!(file instanceof TFile)) return false;
			if (!checking) {
				void (async () => {
					const other = await pickVaultFile(plugin.app, 'Compare with…', parentPath(file.path));
					if (other) await plugin.openPaths(file.path, other, { placement: 'reveal', preferCenter: true, prompt: true });
				})();
			}
			return true;
		},
	});
	plugin.addCommand({
		id: 'diff-current-with-conflict',
		name: 'Meld Diff: Compare current file with its conflict',
		hotkeys: [],
		checkCallback: (checking) => {
			const file = plugin.app.workspace.getActiveFile();
			if (!(file instanceof TFile)) return false;
			const usable = plugin.index.isConflict(file.path) || plugin.index.conflictsFor(file.path).length > 0;
			if (!usable) return false;
			if (!checking) void plugin.compareActiveWithConflict(file);
			return true;
		},
	});
	plugin.addCommand({
		id: 'diff-two-files',
		name: 'Meld Diff: Compare two files…',
		hotkeys: [],
		callback: () => { void plugin.compareTwoFiles(); },
	});
	plugin.addCommand({
		id: 'diff-current-as-left',
		name: 'Meld Diff: Set current file as diff left',
		hotkeys: [],
		checkCallback: (checking) => withActiveFile(plugin, checking, (file) => plugin.setSide('left', file.path)),
	});
	plugin.addCommand({
		id: 'diff-current-as-right',
		name: 'Meld Diff: Set current file as diff right',
		hotkeys: [],
		checkCallback: (checking) => withActiveFile(plugin, checking, (file) => plugin.setSide('right', file.path)),
	});
	plugin.addCommand({
		id: 'scan-conflicts',
		name: 'Meld Diff: Rescan vault for conflicts',
		hotkeys: [],
		callback: () => plugin.rescan(),
	});
	plugin.addCommand({
		id: 'open-next-conflict-diff',
		name: 'Meld Diff: Open next unresolved conflict',
		hotkeys: [],
		callback: () => { void plugin.openNextConflict(); },
	});

	const diffCommand = (id: string, name: string, run: (view: NonNullable<ReturnType<MeldDiffPlugin['getActiveDiffView']>>) => void) => {
		plugin.addCommand({
			id,
			name,
			hotkeys: [],
			checkCallback: (checking) => {
				const view = plugin.getActiveDiffView();
				if (!view) return false;
				if (!checking) run(view);
				return true;
			},
		});
	};
	diffCommand('next-hunk', 'Meld Diff: Next change', (view) => view.nextHunk());
	diffCommand('prev-hunk', 'Meld Diff: Previous change', (view) => view.prevHunk());
	diffCommand('swap-sides', 'Meld Diff: Swap left and right', (view) => view.swap());
	diffCommand('save-left', 'Meld Diff: Save left file', (view) => { void view.saveLeft(); });
	diffCommand('save-right', 'Meld Diff: Save right file', (view) => { void view.saveRight(); });
	diffCommand('save-both', 'Meld Diff: Save both files', (view) => { void view.saveBoth(); });
	diffCommand('pick-left-file', 'Meld Diff: Choose left file', (view) => { void view.pickLeft(); });
	diffCommand('pick-right-file', 'Meld Diff: Choose right file', (view) => { void view.pickRight(); });
	diffCommand('copy-hunk-to-left', 'Meld Diff: Replace left hunk with right', (view) => view.runHunk('replace-left'));
	diffCommand('copy-hunk-to-right', 'Meld Diff: Replace right hunk with left', (view) => view.runHunk('replace-right'));
	diffCommand('insert-hunk-above-left', 'Meld Diff: Insert right hunk above left', (view) => view.runHunk('insert-above-left'));
	diffCommand('insert-hunk-below-left', 'Meld Diff: Insert right hunk below left', (view) => view.runHunk('insert-below-left'));
	diffCommand('insert-hunk-above-right', 'Meld Diff: Insert left hunk above right', (view) => view.runHunk('insert-above-right'));
	diffCommand('insert-hunk-below-right', 'Meld Diff: Insert left hunk below right', (view) => view.runHunk('insert-below-right'));
	diffCommand('delete-hunk-left', 'Meld Diff: Delete left hunk', (view) => view.runHunk('delete-left'));
	diffCommand('delete-hunk-right', 'Meld Diff: Delete right hunk', (view) => view.runHunk('delete-right'));
}

function withActiveFile(plugin: MeldDiffPlugin, checking: boolean, run: (file: TFile) => void): boolean {
	const file = plugin.app.workspace.getActiveFile();
	if (!(file instanceof TFile)) return false;
	if (!checking) run(file);
	return true;
}

function conflictId(placement: Placement): string {
	switch (placement) {
		case 'reveal': return 'open-conflict-view';
		case 'tab': return 'open-conflict-view-new-tab';
		case 'left': return 'open-conflict-view-left';
		case 'right': return 'open-conflict-view-right';
		case 'toggle': return 'toggle-conflict-view';
	}
}

function conflictName(placement: Placement): string {
	switch (placement) {
		case 'reveal': return 'Meld Diff: Open conflict view';
		case 'tab': return 'Meld Diff: Open conflict view in new tab';
		case 'left': return 'Meld Diff: Open conflict view in left sidebar';
		case 'right': return 'Meld Diff: Open conflict view in right sidebar';
		case 'toggle': return 'Meld Diff: Toggle conflict view';
	}
}

function diffId(placement: Placement): string {
	switch (placement) {
		case 'reveal': return 'open-diff-view';
		case 'tab': return 'open-diff-view-new-tab';
		case 'left': return 'open-diff-view-left';
		case 'right': return 'open-diff-view-right';
		case 'toggle': return 'toggle-diff-view';
	}
}

function diffName(placement: Placement): string {
	switch (placement) {
		case 'reveal': return 'Meld Diff: Open diff view';
		case 'tab': return 'Meld Diff: Open diff view in new tab';
		case 'left': return 'Meld Diff: Open diff view in left sidebar';
		case 'right': return 'Meld Diff: Open diff view in right sidebar';
		case 'toggle': return 'Meld Diff: Toggle diff view';
	}
}

