import { definePluginBuild } from '@10x-media/tsdown-config/tsdown.shared'

export default definePluginBuild({
	entry: {
		index: 'src/index.ts',
		'exports/types': 'src/exports/types.ts',
		'exports/client': 'src/exports/client.ts',
		'exports/rsc': 'src/exports/rsc.ts',
		'exports/i18n': 'src/exports/i18n.ts',
	},
	// The build leaves `import './x.css'` in place, so the stylesheets have to land
	// next to their compiled component.
	copy: [
		{ from: 'src/view/index.css', to: 'dist/view' },
		{ from: 'src/fields/AuditRelationshipField.css', to: 'dist/fields' },
	],
})
