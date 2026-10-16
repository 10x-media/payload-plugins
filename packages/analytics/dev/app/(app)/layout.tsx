import { AnalyticsScripts, getTrackerConfig } from '@10x-media/analytics/site'
import config from '@payload-config'
import { draftMode, headers } from 'next/headers'
import { getPayload } from 'payload'
import type { ReactNode } from 'react'
import { ConsentToggle } from '../../components/ConsentToggle'
import { PrerenderReady } from '../../components/PrerenderReady'
import { e2eVendorProfile } from '../../helpers/e2eVendors'

export default async function AppLayout({ children }: { children: ReactNode }) {
	const payload = await getPayload({ config })
	// The incoming headers go in so the install's `scope.resolve` sees the same request it
	// would over the public tracker endpoint; the dev app sets no CSP, so there is no nonce.
	// Draft mode as Next itself verified it, rather than the bare cookie.
	const tracker = await getTrackerConfig(payload, {
		headers: await headers(),
		draft: (await draftMode()).isEnabled,
	})
	// biome-ignore lint/plugin/noProcessEnv: dev app env boundary
	const vendorMode = e2eVendorProfile(process.env.ANALYTICS_E2E_VENDORS) !== undefined
	return (
		// Canvas/CanvasText follow the declared color-scheme, so the demo stays legible
		// in a dark-mode browser without a media query.
		<html lang="en" style={{ colorScheme: 'light dark' }}>
			<body
				style={{
					background: 'Canvas',
					color: 'CanvasText',
					fontFamily: 'system-ui, sans-serif',
					margin: '0 auto',
					maxWidth: '40rem',
					padding: '3rem 1.5rem',
					lineHeight: 1.6,
				}}
			>
				{children}
				<ConsentToggle perSlot={vendorMode} remember={!vendorMode} />
				<AnalyticsScripts config={tracker} />
				<PrerenderReady />
			</body>
		</html>
	)
}
