import { EditorView } from '@codemirror/view';
import { docPosAtScroll, scrollTopForPos } from './mobile-model';

/** Document position at the top of the visible editor, using the text that is actually drawn. */
export function docPosAtTop(view: EditorView): number {
	const point = visiblePoint(view);
	if (point) {
		const pos = view.posAtCoords(point);
		if (pos != null) return pos;
	}
	return docPosAtScroll(view.scrollDOM.scrollTop, view.lineBlockAtHeight(view.scrollDOM.scrollTop));
}

/** Scroll offset that puts `pos` at the top of the viewport. */
export function scrollTopToShow(view: EditorView, pos: number): number {
	const docLength = view.state.doc.length;
	const clamped = Math.max(0, Math.min(docLength, pos));
	const probe = Math.max(0, Math.min(docLength, Math.floor(clamped)));
	const coords = view.coordsAtPos(probe);
	if (coords) {
		const scroller = view.scrollDOM.getBoundingClientRect();
		return Math.max(0, view.scrollDOM.scrollTop + (coords.top - scroller.top));
	}
	return Math.max(0, scrollTopForPos(clamped, view.lineBlockAt(probe)));
}

export function positionDrawn(view: EditorView, pos: number): boolean {
	const docLength = view.state.doc.length;
	const probe = Math.max(0, Math.min(docLength, Math.floor(Math.max(0, Math.min(docLength, pos)))));
	return view.coordsAtPos(probe) != null;
}

function visiblePoint(view: EditorView): { x: number; y: number } | null {
	const scroller = view.scrollDOM.getBoundingClientRect();
	const content = view.contentDOM.getBoundingClientRect();
	if (scroller.height < 1 || content.width < 1) return null;
	const left = Math.max(scroller.left, content.left);
	const right = Math.min(scroller.right, content.right);
	if (right - left < 2) return null;
	return { x: left + Math.min(8, (right - left) / 2), y: scroller.top + 2 };
}
