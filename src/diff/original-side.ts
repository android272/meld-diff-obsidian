/** Where the original file sits in an open pair. `null` is any other pair. */
export type OriginalPlacement = 'a' | 'b' | null;

/**
 * Original on A puts the original on A, which is the left pane on desktop and the top pane on mobile.
 * Off puts it on B, the right pane or the bottom pane.
 * A conflict pair flips only when it disagrees with that. Any other pair that has a file flips too,
 * so changing the setting trades the two panes.
 */
export function shouldFlipSides(originalOnA: boolean, placement: OriginalPlacement, hasFile: boolean): boolean {
	if (!hasFile) return false;
	if (placement === null) return true;
	return (placement === 'a') !== originalOnA;
}
