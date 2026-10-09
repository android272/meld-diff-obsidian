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
		name: 'Compare current file with…',
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
		name: 'Compare current file with its conflict',
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
		name: 'Compare two files…',
		callback: () => { void plugin.compareTwoFiles(); },
	});
	plugin.addCommand({
		id: 'diff-current-as-left',
		name: 'Set current file as A',
		checkCallback: (checking) => withActiveFile(plugin, checking, (file) => plugin.setSide('left', file.path)),
	});
	plugin.addCommand({
		id: 'diff-current-as-right',
		name: 'Set current file as B',
		checkCallback: (checking) => withActiveFile(plugin, checking, (file) => plugin.setSide('right', file.path)),
	});
	plugin.addCommand({
		id: 'scan-conflicts',
		name: 'Rescan vault for conflicts',
		callback: () => plugin.rescan(),
	});
	plugin.addCommand({
		id: 'open-next-conflict-diff',
		name: 'Open next unresolved conflict',
		callback: () => { void plugin.openNextConflict(); },
	});

	type ActiveDiff = NonNullable<ReturnType<MeldDiffPlugin['getActiveDiffView']>>;
	const diffCommand = (id: string, name: string, run: (view: ActiveDiff) => void, ready?: (view: ActiveDiff) => boolean) => {
		plugin.addCommand({
			id,
			name,
			checkCallback: (checking) => {
				const view = plugin.getActiveDiffView();
				if (!view || (ready && !ready(view))) return false;
				if (!checking) run(view);
				return true;
			},
		});
	};
	diffCommand('next-hunk', 'Next change', (view) => view.nextHunk());
	diffCommand('prev-hunk', 'Previous change', (view) => view.prevHunk());
	diffCommand('swap-sides', 'Swap A and B', (view) => view.swap());
	diffCommand('save-left', 'Save file A', (view) => { void view.saveLeft(); }, (view) => view.canSaveSide('left'));
	diffCommand('save-right', 'Save file B', (view) => { void view.saveRight(); }, (view) => view.canSaveSide('right'));
	diffCommand('save-both', 'Save both files', (view) => { void view.saveBoth(); }, (view) => view.canSaveSide('left') || view.canSaveSide('right'));
	diffCommand('pick-left-file', 'Choose file A', (view) => { void view.pickLeft(); });
	diffCommand('pick-right-file', 'Choose file B', (view) => { void view.pickRight(); });
	diffCommand('copy-hunk-to-left', 'Replace A with B', (view) => view.runHunk('replace-left'));
	diffCommand('copy-hunk-to-right', 'Replace B with A', (view) => view.runHunk('replace-right'));
	diffCommand('insert-hunk-above-left', 'Insert B above A', (view) => view.runHunk('insert-above-left'));
	diffCommand('insert-hunk-below-left', 'Insert B below A', (view) => view.runHunk('insert-below-left'));
	diffCommand('insert-hunk-above-right', 'Insert A above B', (view) => view.runHunk('insert-above-right'));
	diffCommand('insert-hunk-below-right', 'Insert A below B', (view) => view.runHunk('insert-below-right'));
	diffCommand('delete-hunk-left', 'Delete hunk on A', (view) => view.runHunk('delete-left'));
	diffCommand('delete-hunk-right', 'Delete hunk on B', (view) => view.runHunk('delete-right'));
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
		case 'reveal': return 'Open conflict view';
		case 'tab': return 'Open conflict view in new tab';
		case 'left': return 'Open conflict view in left sidebar';
		case 'right': return 'Open conflict view in right sidebar';
		case 'toggle': return 'Toggle conflict view';
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
		case 'reveal': return 'Open diff view';
		case 'tab': return 'New diff';
		case 'left': return 'Open diff view in left sidebar';
		case 'right': return 'Open diff view in right sidebar';
		case 'toggle': return 'Toggle diff view';
	}
}

