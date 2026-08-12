'use client'

import { useConfig } from '@payloadcms/ui'
import { useEffect, useState } from 'react'

/** A wiki media document as the video players consume it. */
export type WikiMediaDoc = {
	filename?: null | string
	id: number | string
	mimeType?: null | string
	url?: null | string
}

const cache = new Map<string, Promise<null | WikiMediaDoc>>()

export type WikiMediaDocState = {
	doc: null | WikiMediaDoc
	loading: boolean
}

/**
 * Load one wiki media document by id, cached for the session so a guide with
 * several videos fetches each document once across editor and read surfaces.
 *
 * `cacheBust` is part of the cache key rather than a cache eviction, so every
 * consumer passing the same number shares one request: the editor card and the
 * player it wraps both read a re-saved document once between them. Superseded
 * entries are left behind; they are a handful of strings for the session.
 */
export const useWikiMediaDoc = (
	relationTo: string,
	value: number | string | undefined,
	cacheBust = 0
): WikiMediaDocState => {
	const { config } = useConfig()
	const [state, setState] = useState<WikiMediaDocState>({ doc: null, loading: true })

	useEffect(() => {
		if (value === undefined) {
			setState({ doc: null, loading: false })
			return
		}
		const cacheKey = `${relationTo}:${value}:${cacheBust}`
		let promise = cache.get(cacheKey)
		if (!promise) {
			const base = `${config.serverURL ?? ''}${config.routes.api}`
			promise = fetch(`${base}/${relationTo}/${value}?depth=0`, { credentials: 'include' })
				.then((response) => (response.ok ? (response.json() as Promise<WikiMediaDoc>) : null))
				.catch(() => null)
			cache.set(cacheKey, promise)
		}
		let cancelled = false
		void promise.then((doc) => {
			if (!cancelled) {
				setState({ doc, loading: false })
			}
		})
		return () => {
			cancelled = true
		}
	}, [cacheBust, config.routes.api, config.serverURL, relationTo, value])

	return state
}
