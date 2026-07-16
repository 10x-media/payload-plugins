import { definePluginBuild } from '@10x-media/tsdown-config/tsdown.shared'

export default definePluginBuild({
	entry: {
		index: 'src/index.ts',
		'exports/types': 'src/exports/types.ts',
		'exports/client': 'src/exports/client.ts',
		'exports/rsc': 'src/exports/rsc.ts',
		'exports/i18n': 'src/exports/i18n.ts',
		'exports/color': 'src/exports/color.ts',
		'exports/color-utils': 'src/exports/color-utils.ts',
		'exports/icon': 'src/exports/icon.ts',
		'exports/icon-react': 'src/exports/icon-react.ts',
		'exports/icon-codegen': 'src/exports/icon-codegen.ts',
		'exports/icon-adapters/lucide': 'src/exports/icon-adapters/lucide.ts',
		'exports/icon-adapters/radix': 'src/exports/icon-adapters/radix.ts',
		'exports/icon-adapters/tabler': 'src/exports/icon-adapters/tabler.ts',
		'exports/encrypted': 'src/exports/encrypted.ts',
	},
})
