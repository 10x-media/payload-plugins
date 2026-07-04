import { definePluginBuild } from '@10x-media/tsdown-config/tsdown.shared'

export default definePluginBuild({
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
		'exports/adapters/ga4': 'src/exports/adapters/ga4.ts',
		'exports/adapters/posthog': 'src/exports/adapters/posthog.ts',
	},
})
