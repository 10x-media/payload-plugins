'use client'

import { useEffect } from 'react'

/**
 * The site used to live under /docs. The static export has no pages there
 * anymore, so GitHub Pages serves the 404 page for old links; this strips
 * the prefix and lands on the moved page.
 */
export function LegacyDocsRedirect() {
	useEffect(() => {
		const { pathname, search, hash } = window.location
		if (pathname === '/docs' || pathname.startsWith('/docs/')) {
			window.location.replace((pathname.slice('/docs'.length) || '/') + search + hash)
		}
	}, [])
	return null
}
