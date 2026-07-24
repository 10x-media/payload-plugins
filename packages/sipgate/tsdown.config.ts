import { definePluginBuild } from '@10x-media/tsdown-config/tsdown.shared'

export default definePluginBuild({
	entry: {
		index: 'src/index.ts',
		'exports/types': 'src/exports/types.ts',
		'exports/client': 'src/exports/client.ts',
		'exports/i18n': 'src/exports/i18n.ts',
		'ui/ClickToDialField': 'src/ui/ClickToDialField.tsx',
		'ui/ClickToDialFieldClient': 'src/ui/ClickToDialFieldClient.tsx',
		'ui/CallActivityWidget': 'src/ui/CallActivityWidget.tsx',
		'ui/CallActivityWidgetClient': 'src/ui/CallActivityWidgetClient.tsx',
		'ui/LiveCallFloatingWindow': 'src/ui/LiveCallFloatingWindow.tsx',
		'ui/LiveCallFloatingWindowClient': 'src/ui/LiveCallFloatingWindowClient.tsx',
		'ui/ContactMatchUiField': 'src/ui/ContactMatchUiField.tsx',
		'ui/SipgateContactMatch': 'src/ui/SipgateContactMatch.tsx',
		'ui/SipgateSyncButton': 'src/ui/SipgateSyncButton.tsx',
		'ui/SipgateOAuthButton': 'src/ui/SipgateOAuthButton.tsx',
		'ui/SipgateOAuthButtonClient': 'src/ui/SipgateOAuthButtonClient.tsx',
	},
})
