'use client'

import type { JSXConverterArgs, JSXConvertersFunction } from '@payloadcms/richtext-lexical/react'
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
import type { ResolvedWikiCustomTarget } from '../../plugin/resolveOptions'
import type { WikiGuideDoc, WikiTargetEntry, WikiTargetsResponse } from '../../shared/targetKeys'
import { buildGuideConverters } from '../GuideArticle/guideConverters'
import { resolveClientLabel } from '../TargetSelect/clientBlocks'
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
/**
 * A consumer block renderer. `converters` and `nodesToJSX` come straight from the
 * lexical converter args, so a block holding its own rich text field can render it:
 * `nodesToJSX({ converters, nodes: fields.body.root.children })`.
 */
export type WikiBlockRenderer = ComponentType<{
	converters?: JSXConverterArgs['converters']
	fields: Record<string, unknown>
	nodesToJSX?: JSXConverterArgs['nodesToJSX']
}>

/** A video player replacing the default HTML5 one; receives the media doc. */
export type WikiVideoPlayerComponent = ComponentType<{ media: WikiMediaDoc }>

export type WikiTargetsContextValue = {
	/** Whether the "Covers" chips include the blocks a guide covers. */
	blockChips: boolean
	/** Singular label per block slug, for chips that would otherwise show a slug. */
	blockLabels: Record<string, string>
	/** The reader's evaluated create permission (drives "write this guide"). */
	canCreate: boolean
	/** The reader's evaluated update permission (drives edit shortcuts). */
	canUpdate: boolean
	/**
	 * Label per declared custom target key, resolved for the reader's admin
	 * language, for the chips that would otherwise show a bare key.
	 */
	customLabels: Record<string, string>
	/**
	 * Whether "write this guide" affordances should render: create permission
	 * resolved true AND the configured `writeAffordances` mode allows it here.
	 */
	canWrite: boolean
	/** Wiki edit mode, the per-browser toggle gating write affordances. */
	editMode: boolean
	/** Guides attached to a target key; empty array when none. */
	entriesFor: (key: string) => WikiTargetEntry[]
	/**
	 * Converters for one guide. Takes the heading ids of the document being
	 * rendered: they are assigned per document, so the map cannot be built ahead
	 * of one.
	 */
	guideConverters: (idsByNode: Map<object, string>) => JSXConvertersFunction
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
	blockChips: true,
	blockLabels: {},
	canCreate: false,
	canUpdate: false,
	canWrite: false,
	customLabels: {},
	editMode: false,
	entriesFor: () => EMPTY,
	guideConverters: (idsByNode) => buildGuideConverters({}, {}, idsByNode),
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

/** Stable identity for the common case, so the label memo has nothing to redo. */
const NO_CUSTOM_TARGETS: ResolvedWikiCustomTarget[] = []

export type WikiProviderProps = {
	blockChips?: boolean
	blockLabels?: Record<string, string>
	blockRenderers?: Record<string, WikiBlockRenderer>
	children?: ReactNode
	converters?: JSXConvertersFunction
	customTargets?: ResolvedWikiCustomTarget[]
	inlineBlockRenderers?: Record<string, WikiBlockRenderer>
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
	blockChips = true,
	blockLabels,
	blockRenderers,
	children,
	converters,
	customTargets = NO_CUSTOM_TARGETS,
	inlineBlockRenderers,
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
				.then((doc) => {
					// Only successes are worth keeping: a guide that failed to load once
					// would otherwise read as unavailable every time its drawer is
					// reopened, for the rest of the session.
					if (doc === null) {
						guideCache.current.delete(cacheKey)
					}
					return doc
				})
			guideCache.current.set(cacheKey, promise)
			return promise
		},
		[config.routes.api, config.serverURL, locale, pagesSlug]
	)

	const canCreate = data?.canCreate ?? false

	// A declared label may be keyed by admin language, so it resolves here rather
	// than at config time, where there is no request to read a language from.
	const customLabels = useMemo(
		() =>
			Object.fromEntries(
				customTargets.map((target) => [
					target.key,
					resolveClientLabel(target.label, i18n.language, target.key),
				])
			),
		[customTargets, i18n.language]
	)

	const guideConverters = useMemo(
		() =>
			(idsByNode: Map<object, string>): JSXConvertersFunction =>
			(args) => {
				const base = buildGuideConverters(
					blockRenderers ?? {},
					inlineBlockRenderers ?? {},
					idsByNode
				)(args)
				return converters?.({ defaultConverters: base }) ?? base
			},
		[blockRenderers, converters, inlineBlockRenderers]
	)

	const value = useMemo<WikiTargetsContextValue>(
		() => ({
			blockChips,
			blockLabels: blockLabels ?? {},
			canCreate,
			canUpdate: data?.canUpdate ?? false,
			canWrite:
				canCreate &&
				(writeAffordances === 'always' || (writeAffordances === 'editMode' && editMode)),
			customLabels,
			editMode,
			entriesFor: (key) => data?.targets[key] ?? EMPTY,
			guideConverters,
			loadGuide,
			loading,
			locale,
			pagesSlug,
			// Guide bodies are cached per id and locale for the session, so a refresh
			// that only refetched the targets map would keep serving pre-edit content.
			refresh: () => {
				guideCache.current.clear()
				void load()
			},
			setEditMode,
			videoPlayer,
			wikiViewEnabled: wikiView,
			writeAffordancesToggleable: canCreate && writeAffordances === 'editMode',
		}),
		[
			blockChips,
			blockLabels,
			canCreate,
			customLabels,
			data,
			editMode,
			guideConverters,
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
