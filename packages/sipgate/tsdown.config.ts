import { defineConfig } from 'tsdown'

export default defineConfig({
	entry: {
		index: 'src/index.ts',
		'exports/types': 'src/exports/types.ts',
		'exports/client': 'src/exports/client.ts',
		'exports/i18n': 'src/exports/i18n.ts',
		'ui/ClickToDialField': 'src/ui/ClickToDialField.tsx',
		'ui/CallActivityWidget': 'src/ui/CallActivityWidget.tsx',
		'ui/LiveCallFloatingWindow': 'src/ui/LiveCallFloatingWindow.tsx',
		'ui/ContactMatchUiField': 'src/ui/ContactMatchUiField.tsx',
		'ui/SipgateSyncButton': 'src/ui/SipgateSyncButton.tsx',
	},
	format: 'esm',
	dts: true,
	clean: true,
	treeshake: true,
	sourcemap: true,
	fixedExtension: false,
})
