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
 */
export const useWikiMediaDoc = (
	relationTo: string,
	value: number | string | undefined
): WikiMediaDocState => {
	const { config } = useConfig()
	const [state, setState] = useState<WikiMediaDocState>({ doc: null, loading: true })

	useEffect(() => {
		if (value === undefined) {
			setState({ doc: null, loading: false })
			return
		}
		const cacheKey = `${relationTo}:${value}`
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
	}, [config.routes.api, config.serverURL, relationTo, value])

	return state
}
