'use client'

import { useAuth, useConfig, useTranslation } from '@payloadcms/ui'
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

import type { WikiWriteAffordanceMode } from '../../options'
import type { WikiGuideDoc, WikiTargetEntry, WikiTargetsResponse } from '../../shared/targetKeys'
import type { WikiMediaDoc } from '../Video/useWikiMediaDoc'

const REFRESH_AFTER_MS = 60_000

/** Per-browser wiki edit mode, shared by every admin tab through `localStorage`. */
const EDIT_MODE_STORAGE_KEY = '@10x-media/admin-wiki:editMode'

const readStoredEditMode = (): boolean => {
	try {
		return window.localStorage.getItem(EDIT_MODE_STORAGE_KEY) === '1'
	} catch {
		// Private-mode browsers throw on storage access; edit mode simply stays off.
		return false
	}
}

const writeStoredEditMode = (enabled: boolean): void => {
	try {
		window.localStorage.setItem(EDIT_MODE_STORAGE_KEY, enabled ? '1' : '0')
	} catch {
		// Non-fatal: the toggle still applies for the lifetime of this page.
	}
}

/** A consumer block renderer: receives the block node's field values. */
export type WikiBlockRenderer = ComponentType<{ fields: Record<string, unknown> }>

/** A video player replacing the default HTML5 one; receives the media doc. */
export type WikiVideoPlayerComponent = ComponentType<{ media: WikiMediaDoc }>

export type WikiTargetsContextValue = {
	/** Singular label per block slug, for chips that would otherwise show a slug. */
	blockLabels: Record<string, string>
	/** Consumer block renderers resolved from the import map, keyed by slug. */
	blockRenderers: Record<string, WikiBlockRenderer>
	/** The reader's evaluated create permission (drives "write this guide"). */
	canCreate: boolean
	/** The reader's evaluated update permission (drives edit shortcuts). */
	canUpdate: boolean
	/**
	 * Whether "write this guide" affordances should render: create permission
	 * resolved true AND the configured `writeAffordances` mode allows it here.
	 */
	canWrite: boolean
	/** Wiki edit mode, the per-browser toggle gating write affordances. */
	editMode: boolean
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
	/** Turn wiki edit mode on or off; persisted per browser. */
	setEditMode: (enabled: boolean) => void
	/** Consumer player replacing the default HTML5 player, when configured. */
	videoPlayer: undefined | WikiVideoPlayerComponent
	/** Whether the plugin registered the `/wiki` view, for "open in wiki" links. */
	wikiViewEnabled: boolean
	/**
	 * Whether the edit-mode toggle is worth showing: the configured mode is
	 * `editMode` and this reader could author guides.
	 */
	writeAffordancesToggleable: boolean
}

const EMPTY: WikiTargetEntry[] = []

const WikiTargetsContext = createContext<WikiTargetsContextValue>({
	blockLabels: {},
	blockRenderers: {},
	canCreate: false,
	canUpdate: false,
	canWrite: false,
	editMode: false,
	entriesFor: () => EMPTY,
	loadGuide: () => Promise.resolve(null),
	loading: false,
	locale: null,
	pagesSlug: 'wiki-pages',
	refresh: () => {},
	setEditMode: () => {},
	videoPlayer: undefined,
	wikiViewEnabled: false,
	writeAffordancesToggleable: false,
})

export type WikiProviderProps = {
	blockLabels?: Record<string, string>
	blockRenderers?: Record<string, WikiBlockRenderer>
	children?: ReactNode
	pagesSlug?: string
	videoPlayer?: WikiVideoPlayerComponent
	wikiView?: boolean
	writeAffordances?: WikiWriteAffordanceMode
}

/**
 * Admin-wide provider fetching the targets map once per session (refreshed on
 * window focus when stale), so hundreds of field triggers resolve
 * guide-existence with a synchronous map lookup and never fetch per field.
 */
export const WikiProvider = ({
	blockLabels,
	blockRenderers,
	children,
	pagesSlug = 'wiki-pages',
	videoPlayer,
	wikiView = false,
	writeAffordances = 'editMode',
}: WikiProviderProps) => {
	const { config } = useConfig()
	const { i18n } = useTranslation()
	const { user } = useAuth()
	const [data, setData] = useState<null | WikiTargetsResponse>(null)
	const [loading, setLoading] = useState(true)
	const [editMode, setEditModeState] = useState(false)
	const fetchedAt = useRef(0)
	const guideCache = useRef(new Map<string, Promise<null | WikiGuideDoc>>())

	// Read on mount rather than in the initializer: the provider renders on the
	// server too, where `window` does not exist.
	useEffect(() => setEditModeState(readStoredEditMode()), [])

	const setEditMode = useCallback((enabled: boolean) => {
		setEditModeState(enabled)
		writeStoredEditMode(enabled)
	}, [])

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

	// The provider is admin-wide, so it also mounts on the login screen, where the
	// endpoint can only answer 403. Waiting for a user keeps that noise out of the
	// console and out of the server log.
	useEffect(() => {
		if (!user) {
			setLoading(false)
			return
		}
		void load()
	}, [load, user])

	useEffect(() => {
		if (!user) {
			return
		}
		const onFocus = () => {
			if (Date.now() - fetchedAt.current > REFRESH_AFTER_MS) {
				void load()
			}
		}
		window.addEventListener('focus', onFocus)
		return () => window.removeEventListener('focus', onFocus)
	}, [load, user])

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

	const canCreate = data?.canCreate ?? false

	const value = useMemo<WikiTargetsContextValue>(
		() => ({
			blockLabels: blockLabels ?? {},
			blockRenderers: blockRenderers ?? {},
			canCreate,
			canUpdate: data?.canUpdate ?? false,
			canWrite:
				canCreate &&
				(writeAffordances === 'always' || (writeAffordances === 'editMode' && editMode)),
			editMode,
			entriesFor: (key) => data?.targets[key] ?? EMPTY,
			loadGuide,
			loading,
			locale,
			pagesSlug,
			refresh: () => void load(),
			setEditMode,
			videoPlayer,
			wikiViewEnabled: wikiView,
			writeAffordancesToggleable: canCreate && writeAffordances === 'editMode',
		}),
		[
			blockLabels,
			blockRenderers,
			canCreate,
			data,
			editMode,
			load,
			loadGuide,
			loading,
			locale,
			pagesSlug,
			setEditMode,
			videoPlayer,
			wikiView,
			writeAffordances,
		]
	)

	return <WikiTargetsContext.Provider value={value}>{children}</WikiTargetsContext.Provider>
}

/** Read the wiki targets map anywhere inside the admin. */
export const useWikiTargets = (): WikiTargetsContextValue => useContext(WikiTargetsContext)
