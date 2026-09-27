export class ConflictStatusBar {
	private el: HTMLElement | null = null;

	constructor(
		private readonly addItem: () => HTMLElement,
		private readonly onClick: () => void,
	) {}

	refresh(enabled: boolean, ready: boolean, count: number): void {
		if (!enabled) {
			this.el?.remove();
			this.el = null;
			return;
		}
		if (!this.el) {
			this.el = this.addItem();
			this.el.addClass('meld-diff-status');
			this.el.addEventListener('click', () => this.onClick());
		}
		if (!ready) {
			this.el.setText('Conflicts');
			this.el.removeClass('is-alert');
			return;
		}
		const label = count === 0 ? 'No conflicts' : count === 1 ? '1 conflict' : `${count} conflicts`;
		this.el.setText(label);
		this.el.toggleClass('is-alert', count > 0);
	}

	unload(): void {
		this.el?.remove();
		this.el = null;
	}
}
