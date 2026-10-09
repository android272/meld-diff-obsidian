import { type App, type WorkspaceLeaf } from 'obsidian';
import { CONFLICT_VIEW_TYPE, DIFF_VIEW_TYPE } from './constants';

export type Placement = 'reveal' | 'tab' | 'left' | 'right' | 'toggle';

export interface OpenedView {
	leaf: WorkspaceLeaf;
	created: boolean;
}

const recency: WorkspaceLeaf[] = [];

export function noteActivation(leaf: WorkspaceLeaf | null): void {
	if (!leaf) return;
	const type = leaf.view?.getViewType?.() || leaf.getViewState().type;
	if (type !== CONFLICT_VIEW_TYPE && type !== DIFF_VIEW_TYPE) return;
	const index = recency.indexOf(leaf);
	if (index >= 0) recency.splice(index, 1);
	recency.unshift(leaf);
	if (recency.length > 40) recency.pop();
}

export function collectLeaves(app: App, viewType: string): WorkspaceLeaf[] {
	const out: WorkspaceLeaf[] = [];
	app.workspace.iterateAllLeaves((leaf) => {
		const current = leaf.view?.getViewType?.();
		const declared = leaf.getViewState().type;
		if (current === viewType || declared === viewType) out.push(leaf);
	});
	return out;
}

export function leafZone(app: App, leaf: WorkspaceLeaf): 'left' | 'right' | 'root' | 'float' {
	const root = leaf.getRoot();
	if (root === app.workspace.leftSplit) return 'left';
	if (root === app.workspace.rightSplit) return 'right';
	if (root === app.workspace.rootSplit) return 'root';
	return 'float';
}

function rank(leaf: WorkspaceLeaf): number {
	const index = recency.indexOf(leaf);
	return index === -1 ? 1000 : index;
}

function mostRecent(leaves: WorkspaceLeaf[]): WorkspaceLeaf | null {
	if (leaves.length === 0) return null;
	return [...leaves].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

async function ensureLoaded(leaf: WorkspaceLeaf): Promise<void> {
	const deferred = leaf as WorkspaceLeaf & { loadIfDeferred?: () => Promise<void> };
	if (leaf.isDeferred && deferred.loadIfDeferred) await deferred.loadIfDeferred();
}

async function createLeaf(app: App, viewType: string, where: 'tab' | 'left' | 'right', state: Record<string, unknown>): Promise<WorkspaceLeaf | null> {
	const leaf = where === 'left'
		? app.workspace.getLeftLeaf(false)
		: where === 'right'
			? app.workspace.getRightLeaf(false)
			: app.workspace.getLeaf('tab');
	if (!leaf) return null;
	await leaf.setViewState({ type: viewType, active: true, state });
	await ensureLoaded(leaf);
	await app.workspace.revealLeaf(leaf);
	noteActivation(leaf);
	return leaf;
}

export async function openMeldView(options: {
	app: App;
	viewType: string;
	placement: Placement;
	state?: Record<string, unknown>;
	preferCenter?: boolean;
	/** Ignore sidebar copies and open a main-tab diff. */
	centerOnly?: boolean;
	/** Conflict View's first open goes in the left drawer, and it never uses the right split. */
	mobileConflict?: boolean;
}): Promise<OpenedView | null> {
	const { app, viewType } = options;
	let placement = options.placement;
	const state = options.state ?? {};
	if (placement === 'toggle') {
		const active = app.workspace.activeLeaf;
		if (active && (active.view?.getViewType?.() === viewType || active.getViewState().type === viewType)) {
			active.detach();
			return null;
		}
		placement = 'reveal';
	}
	if (options.mobileConflict && viewType === CONFLICT_VIEW_TYPE) {
		const existing = mostRecent(collectLeaves(app, viewType));
		if (existing) {
			await ensureLoaded(existing);
			await app.workspace.revealLeaf(existing);
			noteActivation(existing);
			return { leaf: existing, created: false };
		}
		const created = await createLeaf(app, viewType, 'left', state);
		return created ? { leaf: created, created: true } : null;
	}
	if (placement === 'tab') {
		const leaf = await createLeaf(app, viewType, 'tab', state);
		return leaf ? { leaf, created: true } : null;
	}
	if (placement === 'left' || placement === 'right') {
		const existing = collectLeaves(app, viewType).filter((leaf) => leafZone(app, leaf) === placement);
		const leaf = mostRecent(existing);
		if (leaf) {
			await ensureLoaded(leaf);
			await app.workspace.revealLeaf(leaf);
			noteActivation(leaf);
			return { leaf, created: false };
		}
		const created = await createLeaf(app, viewType, placement, state);
		return created ? { leaf: created, created: true } : null;
	}
	let leaves = collectLeaves(app, viewType);
	if (options.centerOnly) {
		leaves = leaves.filter((leaf) => {
			const zone = leafZone(app, leaf);
			return zone === 'root' || zone === 'float';
		});
	}
	let pick = mostRecent(leaves);
	if (options.preferCenter && leaves.length > 1 && pick) {
		const center = leaves.filter((leaf) => {
			const zone = leafZone(app, leaf);
			return zone === 'root' || zone === 'float';
		});
		const centerPick = mostRecent(center);
		if (centerPick) pick = centerPick;
	}
	if (pick) {
		await ensureLoaded(pick);
		await app.workspace.revealLeaf(pick);
		noteActivation(pick);
		return { leaf: pick, created: false };
	}
	const created = await createLeaf(app, viewType, 'tab', state);
	return created ? { leaf: created, created: true } : null;
}
