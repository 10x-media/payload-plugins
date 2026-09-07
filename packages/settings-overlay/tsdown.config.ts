import { definePluginBuild } from '@10x-media/tsdown-config/tsdown.shared'

export default definePluginBuild({
	entry: {
		index: 'src/index.ts',
		'exports/types': 'src/exports/types.ts',
		'exports/client': 'src/exports/client.ts',
		'exports/rsc': 'src/exports/rsc.ts',
		'exports/items': 'src/exports/items.ts',
		'exports/embed': 'src/exports/embed.ts',
		'exports/i18n': 'src/exports/i18n.ts',
	},
	// Every stylesheet, by pattern rather than by name, mirroring src/ into
	// dist/. A hand-kept list ships a build whose `import './x.css'` resolves to
	// nothing the moment one is added.
	copy: [{ flatten: false, from: 'src/**/*.css', to: 'dist' }],
})
