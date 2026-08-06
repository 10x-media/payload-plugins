import { definePluginBuild } from '@10x-media/tsdown-config/tsdown.shared'

export default definePluginBuild({
	entry: {
		index: 'src/index.ts',
		'exports/types': 'src/exports/types.ts',
		'exports/client': 'src/exports/client.ts',
		'exports/i18n': 'src/exports/i18n.ts',
	},
	copy: [
		{ from: 'src/client/historyDebugOverlay.css', to: 'dist/client' },
		{ from: 'src/client/undoRedoControls.css', to: 'dist/client' },
	],
})
