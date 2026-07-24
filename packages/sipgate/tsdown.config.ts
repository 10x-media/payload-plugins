import { definePluginBuild } from '@10x-media/tsdown-config/tsdown.shared'

export default definePluginBuild({
	entry: {
		index: 'src/index.ts',
		'exports/types': 'src/exports/types.ts',
		'exports/client': 'src/exports/client.ts',
		'exports/i18n': 'src/exports/i18n.ts',
		// Referenced by Payload as bare component path strings (e.g.
		// '@10x-media/sipgate/ui/ClickToDialField'), so unlike the exports/*
		// barrels above, unbundle mode can't reach these transitively; each
		// needs its own entry. Their *Client counterparts are pulled in
		// automatically since unbundle preserves the whole reachable graph.
		'ui/ClickToDialField': 'src/ui/ClickToDialField.tsx',
		'ui/CallActivityWidget': 'src/ui/CallActivityWidget.tsx',
		'ui/LiveCallFloatingWindow': 'src/ui/LiveCallFloatingWindow.tsx',
		'ui/ContactMatchUiField': 'src/ui/ContactMatchUiField.tsx',
		'ui/SipgateSyncButton': 'src/ui/SipgateSyncButton.tsx',
		'ui/SipgateOAuthButton': 'src/ui/SipgateOAuthButton.tsx',
	},
})
