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
		name: 'Meld Diff: Set current file as A',
		hotkeys: [],
		checkCallback: (checking) => withActiveFile(plugin, checking, (file) => plugin.setSide('left', file.path)),
	});
	plugin.addCommand({
		id: 'diff-current-as-right',
		name: 'Meld Diff: Set current file as B',
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

	type ActiveDiff = NonNullable<ReturnType<MeldDiffPlugin['getActiveDiffView']>>;
	const diffCommand = (id: string, name: string, run: (view: ActiveDiff) => void, ready?: (view: ActiveDiff) => boolean) => {
		plugin.addCommand({
			id,
			name,
			hotkeys: [],
			checkCallback: (checking) => {
				const view = plugin.getActiveDiffView();
				if (!view || (ready && !ready(view))) return false;
				if (!checking) run(view);
				return true;
			},
		});
	};
	diffCommand('next-hunk', 'Meld Diff: Next change', (view) => view.nextHunk());
	diffCommand('prev-hunk', 'Meld Diff: Previous change', (view) => view.prevHunk());
	diffCommand('swap-sides', 'Meld Diff: Swap A and B', (view) => view.swap());
	diffCommand('save-left', 'Meld Diff: Save file A', (view) => { void view.saveLeft(); }, (view) => view.canSaveSide('left'));
	diffCommand('save-right', 'Meld Diff: Save file B', (view) => { void view.saveRight(); }, (view) => view.canSaveSide('right'));
	diffCommand('save-both', 'Meld Diff: Save both files', (view) => { void view.saveBoth(); }, (view) => view.canSaveSide('left') || view.canSaveSide('right'));
	diffCommand('pick-left-file', 'Meld Diff: Choose file A', (view) => { void view.pickLeft(); });
	diffCommand('pick-right-file', 'Meld Diff: Choose file B', (view) => { void view.pickRight(); });
	diffCommand('copy-hunk-to-left', 'Meld Diff: Replace A with B', (view) => view.runHunk('replace-left'));
	diffCommand('copy-hunk-to-right', 'Meld Diff: Replace B with A', (view) => view.runHunk('replace-right'));
	diffCommand('insert-hunk-above-left', 'Meld Diff: Insert B above A', (view) => view.runHunk('insert-above-left'));
	diffCommand('insert-hunk-below-left', 'Meld Diff: Insert B below A', (view) => view.runHunk('insert-below-left'));
	diffCommand('insert-hunk-above-right', 'Meld Diff: Insert A above B', (view) => view.runHunk('insert-above-right'));
	diffCommand('insert-hunk-below-right', 'Meld Diff: Insert A below B', (view) => view.runHunk('insert-below-right'));
	diffCommand('delete-hunk-left', 'Meld Diff: Delete hunk on A', (view) => view.runHunk('delete-left'));
	diffCommand('delete-hunk-right', 'Meld Diff: Delete hunk on B', (view) => view.runHunk('delete-right'));
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
		case 'tab': return 'Meld Diff: New diff';
		case 'left': return 'Meld Diff: Open diff view in left sidebar';
		case 'right': return 'Meld Diff: Open diff view in right sidebar';
		case 'toggle': return 'Meld Diff: Toggle diff view';
	}
}

