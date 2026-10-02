import { definePluginBuild } from '@10x-media/tsdown-config/tsdown.shared'

export default definePluginBuild({
	entry: {
		index: 'src/index.ts',
		'exports/types': 'src/exports/types.ts',
		'exports/client': 'src/exports/client.ts',
		'exports/rsc': 'src/exports/rsc.ts',
		'exports/i18n': 'src/exports/i18n.ts',
	},
	// The build leaves `import './index.css'` in place, so the stylesheet has to land
	// next to the compiled components.
	copy: [{ from: 'src/view/index.css', to: 'dist/view' }],
})
