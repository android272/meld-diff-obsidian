import esbuild from 'esbuild';

await esbuild.build({
	entryPoints: [
		'tests/patterns.test.ts',
		'tests/groups.test.ts',
		'tests/hunk-text.test.ts',
		'tests/hunk-colors.test.ts',
		'tests/mobile-model.test.ts',
		'tests/original-side.test.ts',
	],
	bundle: true,
	platform: 'node',
	format: 'cjs',
	outdir: '/tmp/meld-diff-tests',
	outExtension: { '.js': '.cjs' },
	logLevel: 'warning',
});
