export const CONFLICT_VIEW_TYPE = 'meld-diff-conflicts';
export const DIFF_VIEW_TYPE = 'meld-diff-editor';

export const WARN_FILE_BYTES = Math.round(1.5 * 1024 * 1024);
/** vault.read of a multi-tens-of-MB note will freeze the UI. The 1.5 MB mark still loads. */
export const HARD_FILE_BYTES = 15 * 1024 * 1024;

export const BINARY_EXTENSIONS = new Set([
	'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'ico', 'icns', 'heic', 'heif',
	'pdf', 'mp3', 'mp4', 'mov', 'avi', 'mkv', 'webm', 'wav', 'ogg', 'flac', 'aac', 'm4a',
	'zip', 'gz', 'tgz', 'bz2', '7z', 'rar', 'tar', 'exe', 'dmg', 'woff', 'woff2', 'ttf', 'otf',
	'eot', 'sqlite', 'db', 'bin', 'wasm', 'class', 'so', 'dylib',
]);
