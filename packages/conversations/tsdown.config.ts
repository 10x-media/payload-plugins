import { definePluginBuild } from '@10x-media/tsdown-config/tsdown.shared'

export default definePluginBuild({
	entry: {
		index: 'src/index.ts',
		'exports/types': 'src/exports/types.ts',
		'exports/client': 'src/exports/client.ts',
		'exports/react': 'src/exports/react.ts',
		'exports/comments': 'src/exports/comments.ts',
		'exports/i18n': 'src/exports/i18n.ts',
	},
	copy: [{ flatten: false, from: 'src/**/*.css', to: 'dist' }],
})
