import { definePluginBuild } from '@10x-media/tsdown-config/tsdown.shared'

export default definePluginBuild({
	entry: {
		index: 'src/index.ts',
		'exports/types': 'src/exports/types.ts',
		'exports/client': 'src/exports/client.ts',
		'exports/react': 'src/exports/react.ts',
		'exports/composer': 'src/exports/composer.ts',
		'exports/comments': 'src/exports/comments.ts',
		'exports/reactions': 'src/exports/reactions.ts',
		'exports/reactions-react': 'src/exports/reactions-react.ts',
		'exports/rsc': 'src/exports/rsc.ts',
		'exports/i18n': 'src/exports/i18n.ts',
	},
	copy: [{ flatten: false, from: 'src/**/*.css', to: 'dist' }],
})
