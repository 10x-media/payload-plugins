'use client'

import { useEffect } from 'react'

interface Move {
	page: string
	/** Sections that moved to another page than the rest; any other anchor is kept on `page`. */
	sections?: Record<string, string>
	/** Where a link with no anchor lands, when that is a section of `page`. */
	landing?: string
}

const MOVED: Record<string, Move> = {
	'/analytics/adapters': {
		page: '/analytics/providers',
		sections: {
			'the-capabilities-model': '/analytics/reference/adapter-contract#the-capabilities-model',
			'testing-memoryadapter': '/analytics/reference/adapter-contract#testing-memoryadapter',
			'writing-your-own-adapter': '/analytics/reference/adapter-contract#writing-your-own-adapter',
		},
	},
	'/analytics/coexistence': {
		page: '/analytics/providers',
		landing: 'running-beside-an-existing-setup',
	},
	'/analytics/data-sources': {
		page: '/analytics/reference/endpoints',
		sections: {
			'what-a-source-is': '/analytics/concepts#sources-and-adapters',
			'multi-tenancy': '/analytics/reference/endpoints#scope-on-the-read-endpoints',
			'the-one-endpoint-with-no-envelope': '/analytics/reference/endpoints#capture-proxy',
		},
	},
	'/analytics/i18n': { page: '/analytics/reference/translations' },
}

/** Where an old address lands now, or null when it never moved. */
const movedTo = (pathname: string, hash: string): string | null => {
	const move = MOVED[pathname.replace(/\/+$/, '')]
	if (!move) {
		return null
	}
	const anchor = hash.replace(/^#/, '')
	const section = anchor ? move.sections?.[anchor] : undefined
	if (section) {
		return section
	}
	const target = anchor || move.landing
	return target ? `${move.page}#${target}` : move.page
}

/**
 * The site used to live under /docs, and some analytics pages were merged into others. The
 * static export has no pages at the old addresses, so GitHub Pages serves the 404 page for old
 * links; this lands them on the page and section that took the content.
 */
export function LegacyDocsRedirect() {
	useEffect(() => {
		const { pathname, search, hash } = window.location
		const unprefixed =
			pathname === '/docs' || pathname.startsWith('/docs/')
				? pathname.slice('/docs'.length) || '/'
				: null
		const path = unprefixed ?? pathname
		const moved = movedTo(path, hash)
		if (moved) {
			const [page, anchor] = moved.split('#')
			window.location.replace(`${page}${search}${anchor ? `#${anchor}` : ''}`)
		} else if (unprefixed !== null) {
			window.location.replace(unprefixed + search + hash)
		}
	}, [])
	return null
}
