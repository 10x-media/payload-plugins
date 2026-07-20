'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

/**
 * Fires one real pageview into the plugin's ingest endpoint per client-side
 * navigation, so browsing the dev frontend produces live analytics events.
 */
export function TrackPageview() {
	const pathname = usePathname()
	useEffect(() => {
		void fetch('/api/analytics/ingest', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				type: 'pageview',
				path: pathname,
				hostname: window.location.hostname,
				referrer: document.referrer || undefined,
			}),
		})
	}, [pathname])
	return null
}
