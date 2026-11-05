import { definePluginBuild } from '@10x-media/tsdown-config/tsdown.shared'

export default definePluginBuild({
	entry: {
		index: 'src/index.ts',
		'exports/types': 'src/exports/types.ts',
		'exports/attributes': 'src/exports/attributes.ts',
		'exports/client': 'src/exports/client.ts',
		'exports/i18n': 'src/exports/i18n.ts',
		'exports/testing': 'src/exports/testing.ts',
		'exports/geo': 'src/exports/geo.ts',
		'exports/next': 'src/exports/next.ts',
		'exports/migrations': 'src/exports/migrations.ts',
		'migrations/predefined/dropLegacyMongo': 'src/migrations/predefined/dropLegacyMongo.ts',
		'exports/rsc': 'src/exports/rsc.ts',
		'exports/site': 'src/exports/site.ts',
		'exports/tracker': 'src/exports/tracker.ts',
		'exports/react': 'src/exports/react.ts',
		'exports/adapters/native': 'src/exports/adapters/native.ts',
		'exports/adapters/plausible': 'src/exports/adapters/plausible.ts',
		'exports/adapters/umami': 'src/exports/adapters/umami.ts',
		'exports/adapters/ga4': 'src/exports/adapters/ga4.ts',
		'exports/adapters/posthog': 'src/exports/adapters/posthog.ts',
	},
	// Every admin surface imports the one stylesheet, which the build leaves as an import, so it
	// has to land where those imports point.
	copy: [{ from: 'src/ui/analytics.css', to: 'dist/ui' }],
})
