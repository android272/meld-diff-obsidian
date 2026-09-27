import { BINARY_EXTENSIONS } from './constants';

export function fileName(path: string | null | undefined): string {
	if (!path) return '';
	const slash = path.lastIndexOf('/');
	return slash === -1 ? path : path.slice(slash + 1);
}

export function parentPath(path: string): string {
	const slash = path.lastIndexOf('/');
	return slash === -1 ? '' : path.slice(0, slash);
}

export function joinPath(folder: string, name: string): string {
	if (!folder || folder === '/') return name;
	return `${folder.replace(/\/+$/, '')}/${name}`;
}

export function extensionOf(path: string): string {
	const base = fileName(path);
	const dot = base.lastIndexOf('.');
	if (dot <= 0) return '';
	return base.slice(dot + 1).toLowerCase();
}

export function isBinaryExtension(path: string): boolean {
	const ext = extensionOf(path);
	return ext !== '' && BINARY_EXTENSIONS.has(ext);
}

export function formatBytes(size: number): string {
	if (!Number.isFinite(size) || size < 0) return '';
	if (size < 1024) return `${Math.round(size)} B`;
	if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
	return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatStamp(date?: string, time?: string): string {
	if (!date || date.length < 8) return '';
	const year = Number(date.slice(0, 4));
	const month = Number(date.slice(4, 6));
	const day = Number(date.slice(6, 8));
	const hours = time && time.length >= 2 ? Number(time.slice(0, 2)) : 0;
	const minutes = time && time.length >= 4 ? Number(time.slice(2, 4)) : 0;
	const stamp = new Date(year, month - 1, day, hours, minutes);
	if (Number.isNaN(stamp.getTime())) return '';
	return stamp.toLocaleString(undefined, {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
	});
}

export function isMarkdownPath(path: string | null): boolean {
	if (!path) return false;
	const ext = extensionOf(path);
	return ext === 'md' || ext === 'markdown';
}
