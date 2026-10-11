'use client'

import { useLayoutEffect } from 'react'

/**
 * Titles the tab in the reader's language, which Payload's `meta` cannot, and re-titles on every
 * head change since Next writes its title after mount. Layout effect: lets go before next page's.
 */
export function DocumentTitle({ title }: { title: string }) {
	useLayoutEffect(() => {
		const rename = () => {
			if (document.title !== title) {
				document.title = title
			}
		}
		rename()
		const observer = new MutationObserver(rename)
		observer.observe(document.head, { characterData: true, childList: true, subtree: true })
		return () => observer.disconnect()
	}, [title])
	return null
}
