import { defineConfig } from 'tsdown'

export default defineConfig({
	entry: {
		index: 'src/index.ts',
		'exports/types': 'src/exports/types.ts',
		'exports/client': 'src/exports/client.ts',
		'exports/i18n': 'src/exports/i18n.ts',
		'testing/memoryAdapter': 'src/testing/memoryAdapter.ts',
		'exports/geo': 'src/exports/geo.ts',
		'exports/rsc': 'src/exports/rsc.ts',
		'exports/adapters/native': 'src/exports/adapters/native.ts',
		'exports/adapters/plausible': 'src/exports/adapters/plausible.ts',
		'exports/adapters/umami': 'src/exports/adapters/umami.ts',
	},
	format: 'esm',
	dts: true,
	clean: true,
	treeshake: true,
	sourcemap: true,
	fixedExtension: false,
})
