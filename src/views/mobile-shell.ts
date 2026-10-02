import { getIcon, setIcon } from 'obsidian';
import type { HunkAction } from '../diff/hunk-actions';
import { actionTip, type BarActions, type SummaryDocument } from '../diff/mobile-model';

type Side = 'left' | 'right';

interface ActionSpec {
	icon: string;
	fallback: string;
	label: string;
	action: HunkAction;
	key: keyof BarActions;
}

const TOP_ACTIONS: ActionSpec[] = [
	{ icon: 'arrow-down', fallback: 'arrow-down', label: 'Replace B with this hunk', action: 'replace-right', key: 'replace' },
	{ icon: 'between-vertical-start', fallback: 'arrow-up-to-line', label: 'Insert this above the hunk on B', action: 'insert-above-right', key: 'above' },
	{ icon: 'between-vertical-end', fallback: 'arrow-down-to-line', label: 'Insert this below the hunk on B', action: 'insert-below-right', key: 'below' },
	{ icon: 'trash-2', fallback: 'trash', label: 'Delete this hunk on A', action: 'delete-left', key: 'delete' },
];

const BOTTOM_ACTIONS: ActionSpec[] = [
	{ icon: 'arrow-up', fallback: 'arrow-up', label: 'Replace A with this hunk', action: 'replace-left', key: 'replace' },
	{ icon: 'between-vertical-start', fallback: 'arrow-up-to-line', label: 'Insert this above the hunk on A', action: 'insert-above-left', key: 'above' },
	{ icon: 'between-vertical-end', fallback: 'arrow-down-to-line', label: 'Insert this below the hunk on A', action: 'insert-below-left', key: 'below' },
	{ icon: 'trash-2', fallback: 'trash', label: 'Delete this hunk on B', action: 'delete-right', key: 'delete' },
];

export interface MobileShellHandlers {
	pick(side: Side): void;
	focus(side: Side): void;
	action(side: Side, action: HunkAction): void;
	menu(side: Side, event: MouseEvent): void;
	cog(event: MouseEvent): void;
	summary(): void;
	prev(): void;
	next(): void;
	closeSummary(): void;
	focusChunk(index: number, side: Side): void;
}

function paintIcon(target: HTMLElement, name: string, fallback: string): void {
	setIcon(target, getIcon(name) ? name : fallback);
}

/**
 * Phone chrome around the two stacked editors: file bars, hunk buttons, and the summary.
 * The editors themselves are mounted into `editors` by StackedHost.
 */
export class MobileShell {
	readonly root: HTMLElement;
	readonly bannerEl: HTMLElement;
	readonly editors: Record<Side, HTMLElement>;
	private readonly labels: Record<Side, HTMLElement>;
	private readonly captions: Record<Side, HTMLElement>;
	private readonly panes: Record<Side, HTMLElement>;
	private readonly buttons: Record<Side, HTMLButtonElement[]> = { left: [], right: [] };
	private readonly summaryEl: HTMLElement;
	private readonly summaryBody: HTMLElement;
	private readonly removedEl: HTMLElement;
	private readonly addedEl: HTMLElement;

	constructor(parent: HTMLElement, private readonly handlers: MobileShellHandlers) {
		this.root = parent.createDiv({ cls: 'meld-mobile' });
		const top = this.root.createDiv({ cls: 'meld-mobile-top' });
		this.iconButton(top, 'file-text', 'file', 'Difference summary', () => this.handlers.summary());
		this.iconButton(top, 'settings', 'settings', 'Display options', (event) => this.handlers.cog(event));
		this.bannerEl = this.root.createDiv({ cls: 'meld-banners' });
		const stack = this.root.createDiv({ cls: 'meld-mobile-stack' });
		const left = this.pane(stack, 'left', 'A', TOP_ACTIONS);
		const right = this.pane(stack, 'right', 'B', BOTTOM_ACTIONS);
		this.panes = { left: left.pane, right: right.pane };
		this.labels = { left: left.label, right: right.label };
		this.captions = { left: left.caption, right: right.caption };
		this.editors = { left: left.editor, right: right.editor };
		const dock = this.root.createDiv({ cls: 'meld-mobile-dock' });
		this.textButton(dock, 'Prev', 'Previous change', () => this.handlers.prev());
		this.textButton(dock, 'Next', 'Next change', () => this.handlers.next());
		this.textButton(dock, 'Summary', 'Difference summary', () => this.handlers.summary());
		this.summaryEl = this.root.createDiv({ cls: 'meld-summary' });
		const summaryTop = this.summaryEl.createDiv({ cls: 'meld-mobile-top' });
		this.iconButton(summaryTop, 'arrow-left', 'arrow-left', 'Back to diff', () => this.handlers.closeSummary());
		summaryTop.createDiv({ cls: 'meld-summary-title', text: 'Difference summary' });
		const chips = this.summaryEl.createDiv({ cls: 'meld-summary-chips' });
		this.removedEl = chips.createSpan({ cls: 'meld-summary-chip is-removed', text: 'Removed: 0' });
		this.addedEl = chips.createSpan({ cls: 'meld-summary-chip is-added', text: 'Added: 0' });
		this.summaryBody = this.summaryEl.createDiv({ cls: 'meld-summary-doc' });
		this.panes.left.addClass('is-focused');
	}

	label(side: Side): HTMLElement {
		return this.labels[side];
	}

	setBar(side: Side, actions: BarActions, armed: HunkAction | null, caption: string): void {
		const specs = side === 'left' ? TOP_ACTIONS : BOTTOM_ACTIONS;
		const buttons = this.buttons[side];
		for (let index = 0; index < specs.length; index++) {
			const spec = specs[index];
			const button = buttons[index];
			if (!spec || !button) continue;
			const enabled = actions[spec.key];
			button.disabled = !enabled;
			button.toggleClass('is-armed', enabled && armed === spec.action);
			const label = actionTip(spec.key, actions, spec.label);
			button.setAttribute('aria-label', label);
			button.title = label;
		}
		this.captions[side].setText(caption);
		this.captions[side].toggleClass('is-empty', caption.length === 0);
	}

	setFocused(side: Side): void {
		this.panes.left.toggleClass('is-focused', side === 'left');
		this.panes.right.toggleClass('is-focused', side === 'right');
	}

	showSummary(doc: SummaryDocument | null): void {
		if (!doc) {
			this.root.removeClass('is-summary');
			return;
		}
		this.removedEl.setText(`Removed: ${doc.removed}`);
		this.addedEl.setText(`Added: ${doc.added}`);
		this.summaryBody.empty();
		const changed = doc.spans.some((span) => span.kind !== 'same');
		if (!changed) {
			this.summaryBody.createDiv({ cls: 'meld-empty', text: 'No differences.' });
		} else {
			for (const span of doc.spans) {
				if (span.kind === 'same') {
					this.summaryBody.createSpan({ text: span.text });
					continue;
				}
				const index = span.chunk;
				const el = this.summaryBody.createEl('span', {
					cls: span.kind === 'delete' ? 'meld-summary-del' : 'meld-summary-ins',
					text: span.text,
					attr: { role: 'button', tabindex: '0' },
				});
				const open = () => {
					if (index === null) return;
					this.handlers.focusChunk(index, span.kind === 'delete' ? 'left' : 'right');
				};
				el.addEventListener('click', open);
				el.addEventListener('keydown', (event) => {
					if (event.key === 'Enter' || event.key === ' ') {
						event.preventDefault();
						open();
					}
				});
			}
		}
		this.root.addClass('is-summary');
	}

	private pane(parent: HTMLElement, side: Side, letter: 'A' | 'B', actions: ActionSpec[]): { pane: HTMLElement; label: HTMLElement; caption: HTMLElement; editor: HTMLElement } {
		const pane = parent.createDiv({ cls: 'meld-mobile-pane' });
		const bar = pane.createDiv({ cls: 'meld-mobile-bar' });
		bar.createSpan({ cls: `meld-side-badge is-${letter === 'A' ? 'a' : 'b'}`, text: letter });
		const label = bar.createEl('button', { cls: 'meld-file-button' });
		label.addEventListener('click', () => this.handlers.pick(side));
		const more = bar.createEl('button', { cls: 'clickable-icon meld-more', attr: { 'aria-label': `${letter} file actions` } });
		setIcon(more, 'more-vertical');
		more.addEventListener('click', (event) => this.handlers.menu(side, event));
		const tools = bar.createDiv({ cls: 'meld-mobile-actions' });
		for (const spec of actions) {
			const button = tools.createEl('button', { cls: 'clickable-icon meld-mobile-action', attr: { 'aria-label': spec.label } });
			button.title = spec.label;
			button.disabled = true;
			paintIcon(button, spec.icon, spec.fallback);
			button.addEventListener('mousedown', (event) => event.preventDefault());
			button.addEventListener('click', (event) => {
				event.preventDefault();
				this.handlers.action(side, spec.action);
			});
			this.buttons[side].push(button);
		}
		bar.addEventListener('click', (event) => {
			const view = bar.closest('.meld-diff-view');
			const collapsed = view?.classList.contains('is-keyboard') && !pane.classList.contains('is-focused');
			if (!collapsed) return;
			event.preventDefault();
			event.stopPropagation();
			this.handlers.focus(side);
		}, true);
		const caption = pane.createDiv({ cls: 'meld-hunk-caption' });
		const editor = pane.createDiv({ cls: 'meld-mobile-editor' });
		return { pane, label, caption, editor };
	}

	private iconButton(parent: HTMLElement, icon: string, fallback: string, label: string, action: (event: MouseEvent) => void): void {
		const button = parent.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': label } });
		button.title = label;
		paintIcon(button, icon, fallback);
		button.addEventListener('click', (event) => {
			event.preventDefault();
			action(event);
		});
	}

	private textButton(parent: HTMLElement, text: string, label: string, action: () => void): void {
		const button = parent.createEl('button', { cls: 'meld-text-button', text, attr: { 'aria-label': label } });
		button.title = label;
		button.addEventListener('click', (event) => {
			event.preventDefault();
			action();
		});
	}
}
