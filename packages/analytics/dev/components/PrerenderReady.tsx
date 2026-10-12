'use client'

import { useEffect } from 'react'
import { PRERENDER_READY_KEY } from '../helpers/prerenderReady'

/**
 * Says a prerendered page is ready: rendered after `<AnalyticsScripts />`, its effect runs once
 * the tracker's has, so the tracker booted. A page the visitor sees directly writes nothing.
 */
export const PrerenderReady = (): null => {
	useEffect(() => {
		if (Reflect.get(document, 'prerendering') !== true) {
			return
		}
		try {
			window.localStorage.setItem(PRERENDER_READY_KEY, `${location.pathname} ${Date.now()}`)
		} catch {
			// Storage blocked: the suite waits out its cap and reports the page never got ready.
		}
	}, [])
	return null
}
