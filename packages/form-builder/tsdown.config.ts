import { defineConfig } from 'tsdown'

export default defineConfig({
	entry: {
		index: 'src/index.ts',
		'exports/types': 'src/exports/types.ts',
		'exports/client': 'src/exports/client.ts',
		'exports/react': 'src/exports/react.ts',
		'exports/rsc': 'src/exports/rsc.ts',
		'exports/i18n': 'src/exports/i18n.ts',
	},
	format: 'esm',
	dts: true,
	clean: true,
	treeshake: true,
	sourcemap: true,
	fixedExtension: false,
})
