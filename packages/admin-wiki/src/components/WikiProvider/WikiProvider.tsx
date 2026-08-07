'use client'

import { useConfig, useTranslation } from '@payloadcms/ui'
import {
	type ComponentType,
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react'

import type { WikiGuideDoc, WikiTargetEntry, WikiTargetsResponse } from '../../shared/targetKeys'
import type { WikiMediaDoc } from '../Video/useWikiMediaDoc'

const REFRESH_AFTER_MS = 60_000

/** A consumer block renderer: receives the block node's field values. */
export type WikiBlockRenderer = ComponentType<{ fields: Record<string, unknown> }>

/** A video player replacing the default HTML5 one; receives the media doc. */
export type WikiVideoPlayerComponent = ComponentType<{ media: WikiMediaDoc }>

export type WikiTargetsContextValue = {
	/** Consumer block renderers resolved from the import map, keyed by slug. */
	blockRenderers: Record<string, WikiBlockRenderer>
	/** The reader's evaluated create permission (drives "write this guide"). */
	canCreate: boolean
	/** The reader's evaluated update permission (drives edit shortcuts). */
	canUpdate: boolean
	/** Guides attached to a target key; empty array when none. */
	entriesFor: (key: string) => WikiTargetEntry[]
	/** Lazily load one guide's full document, cached per id and locale. */
	loadGuide: (id: number | string) => Promise<null | WikiGuideDoc>
	loading: boolean
	/** The content locale guides resolve in for this reader; null when not localized. */
	locale: null | string
	/** The wiki pages collection slug, for links and lazy content loads. */
	pagesSlug: string
	refresh: () => void
	/** Consumer player replacing the default HTML5 player, when configured. */
	videoPlayer: undefined | WikiVideoPlayerComponent
	/** Whether the plugin registered the `/wiki` view, for "open in wiki" links. */
	wikiViewEnabled: boolean
}

const EMPTY: WikiTargetEntry[] = []

const WikiTargetsContext = createContext<WikiTargetsContextValue>({
	blockRenderers: {},
	canCreate: false,
	canUpdate: false,
	entriesFor: () => EMPTY,
	loadGuide: () => Promise.resolve(null),
	loading: false,
	locale: null,
	pagesSlug: 'wiki-pages',
	refresh: () => {},
	videoPlayer: undefined,
	wikiViewEnabled: false,
})

export type WikiProviderProps = {
	blockRenderers?: Record<string, WikiBlockRenderer>
	children?: ReactNode
	pagesSlug?: string
	videoPlayer?: WikiVideoPlayerComponent
	wikiView?: boolean
}

/**
 * Admin-wide provider fetching the targets map once per session (refreshed on
 * window focus when stale), so hundreds of field triggers resolve
 * guide-existence with a synchronous map lookup and never fetch per field.
 */
export const WikiProvider = ({
	blockRenderers,
	children,
	pagesSlug = 'wiki-pages',
	videoPlayer,
	wikiView = false,
}: WikiProviderProps) => {
	const { config } = useConfig()
	const { i18n } = useTranslation()
	const [data, setData] = useState<null | WikiTargetsResponse>(null)
	const [loading, setLoading] = useState(true)
	const fetchedAt = useRef(0)
	const guideCache = useRef(new Map<string, Promise<null | WikiGuideDoc>>())

	const load = useCallback(async () => {
		fetchedAt.current = Date.now()
		try {
			const base = `${config.serverURL ?? ''}${config.routes.api}`
			const url = `${base}/${pagesSlug}/targets-map?language=${encodeURIComponent(i18n.language)}`
			const response = await fetch(url, { credentials: 'include' })
			if (response.ok) {
				setData((await response.json()) as WikiTargetsResponse)
			}
		} catch {
			// Network failures leave the last known map in place; triggers simply
			// render from stale data until the next successful refresh.
		} finally {
			setLoading(false)
		}
	}, [config.routes.api, config.serverURL, i18n.language, pagesSlug])

	useEffect(() => {
		void load()
	}, [load])

	useEffect(() => {
		const onFocus = () => {
			if (Date.now() - fetchedAt.current > REFRESH_AFTER_MS) {
				void load()
			}
		}
		window.addEventListener('focus', onFocus)
		return () => window.removeEventListener('focus', onFocus)
	}, [load])

	const locale = data?.locale ?? null

	const loadGuide = useCallback(
		(id: number | string): Promise<null | WikiGuideDoc> => {
			const cacheKey = `${id}:${locale ?? ''}`
			const cached = guideCache.current.get(cacheKey)
			if (cached) {
				return cached
			}
			const base = `${config.serverURL ?? ''}${config.routes.api}`
			const params = new URLSearchParams({ depth: '1', draft: 'false' })
			if (locale) {
				params.set('locale', locale)
			}
			const promise = fetch(`${base}/${pagesSlug}/${id}?${params.toString()}`, {
				credentials: 'include',
			})
				.then((response) => (response.ok ? (response.json() as Promise<WikiGuideDoc>) : null))
				.catch(() => null)
			guideCache.current.set(cacheKey, promise)
			return promise
		},
		[config.routes.api, config.serverURL, locale, pagesSlug]
	)

	const value = useMemo<WikiTargetsContextValue>(
		() => ({
			blockRenderers: blockRenderers ?? {},
			canCreate: data?.canCreate ?? false,
			canUpdate: data?.canUpdate ?? false,
			entriesFor: (key) => data?.targets[key] ?? EMPTY,
			loadGuide,
			loading,
			locale,
			pagesSlug,
			refresh: () => void load(),
			videoPlayer,
			wikiViewEnabled: wikiView,
		}),
		[blockRenderers, data, loadGuide, loading, locale, load, pagesSlug, videoPlayer, wikiView]
	)

	return <WikiTargetsContext.Provider value={value}>{children}</WikiTargetsContext.Provider>
}

/** Read the wiki targets map anywhere inside the admin. */
export const useWikiTargets = (): WikiTargetsContextValue => useContext(WikiTargetsContext)
