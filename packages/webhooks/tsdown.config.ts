import { definePluginBuild } from '@10x-media/tsdown-config/tsdown.shared'

export default definePluginBuild({
	entry: {
		index: 'src/index.ts',
		'exports/types': 'src/exports/types.ts',
		'exports/client': 'src/exports/client.ts',
		'exports/i18n': 'src/exports/i18n.ts',
	},
	// CSS imported by a client component stays external in the shared build, so every stylesheet is
	// copied beside the module that imports it, mirroring src/ into dist/, or the consumer's bundler
	// resolves the import to nothing and the styles silently never ship.
	copy: [{ flatten: false, from: 'src/**/*.css', to: 'dist' }],
})
