import { Platform } from 'obsidian';
import type { MeldDiffSettings } from '../types';

/** Phone, or the desktop preview toggle. Both use the stacked diff from §16. */
export function wantsMobileLayout(settings: MeldDiffSettings): boolean {
	return Platform.isMobile || settings.forceMobileLayout;
}
