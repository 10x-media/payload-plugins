import { AnalyticsScripts, getTrackerConfig } from '@10x-media/analytics/rsc'
import config from '@payload-config'
import { headers } from 'next/headers'
import { getPayload } from 'payload'
import type { ReactNode } from 'react'

export default async function AppLayout({ children }: { children: ReactNode }) {
	const payload = await getPayload({ config })
	// The incoming headers go in so the install's scopeResolver sees the same request it
	// would over the public tracker endpoint; the dev app sets no CSP, so there is no nonce.
	const tracker = await getTrackerConfig(payload, { headers: await headers() })
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
				<AnalyticsScripts config={tracker} />
			</body>
		</html>
	)
}
