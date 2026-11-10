'use client'

import { getTranslation } from '@payloadcms/translations'
import {
	Button,
	FieldLabel,
	HierarchyListView,
	ReactSelect,
	RouteCacheProvider,
	RouterAdapterContext,
	useAuth,
	useConfig,
	useDocumentSelection,
	useListDrawerContext,
	useTranslation,
} from '@payloadcms/ui'
import type {
	CollectionSlug,
	HierarchyViewData,
	ListViewClientProps,
	RouterAdapterRouter,
} from 'payload'
import React from 'react'
import { createPortal } from 'react-dom'

import { type BrowseState, browseStateFromURL, browseStateToParams } from './browseState'
import { fetchHierarchyData } from './fetchHierarchyData'
import { acceptsWhere, type FolderHierarchy, notChosenWhere } from './hierarchy'
import { useChosenUploads } from './useChosenUploads'

const baseClass = 'folder-picker'

/**
 * The polymorphic collection switch the drawer's own header carries. Payload's
 * `DrawerRelationshipSelect` is internal, so this repeats its markup; switching re-renders the
 * drawer's list for the new collection, as it does on the list tab.
 */
const CollectionSelect: React.FC = () => {
	const { i18n, t } = useTranslation()
	const inputID = React.useId()
	const {
		config: { collections },
		getEntityConfig,
	} = useConfig()
	const { enabledCollections, selectedOption, setSelectedOption } = useListDrawerContext()

	const enabled = collections.filter(({ slug }) => enabledCollections?.includes(slug))
	if (enabled.length < 2 || !selectedOption || !setSelectedOption) {
		return null
	}
	const active = getEntityConfig({ collectionSlug: selectedOption.value })

	return (
		<div className="list-drawer__select-collection-wrap">
			<FieldLabel htmlFor={inputID} label={t('upload:selectCollectionToBrowse')} />
			<ReactSelect
				className="list-header__select-collection"
				id="select-collection__list-drawer"
				inputId={inputID}
				isClearable={false}
				onChange={(option) => {
					if (option && !Array.isArray(option)) {
						setSelectedOption(option as typeof selectedOption)
					}
				}}
				options={enabled.map((collection) => ({
					label: getTranslation(collection.labels.singular, i18n),
					value: collection.slug,
				}))}
				value={{
					label: getTranslation(active?.labels.singular ?? '', i18n),
					value: active?.slug ?? selectedOption.value,
				}}
			/>
		</div>
	)
}

/**
 * Renders `children` into a part of the view's header. What goes there has to render inside the
 * view's providers (the selection lives in its `DocumentSelectionProvider`), and the `Description`
 * slot is the only one inside them, so it mounts there and portals out.
 */
const HeaderPortal: React.FC<{ readonly children: React.ReactNode; readonly into: string }> = ({
	children,
	into,
}) => {
	const anchor = React.useRef<HTMLSpanElement>(null)
	const [target, setTarget] = React.useState<Element | null>(null)

	React.useLayoutEffect(() => {
		setTarget(anchor.current?.closest('.hierarchy-list-header')?.querySelector(into) ?? null)
	}, [into])

	return (
		<span hidden ref={anchor}>
			{target ? createPortal(children, target) : null}
		</span>
	)
}

/**
 * The drawer's title: where the list tab says "Media", this says where the folder tab is, root to
 * current folder. The route view keeps the trail in the admin step nav, which a drawer must leave
 * alone, and titles itself with the current folder; one line does both here. The last crumb is the
 * current folder and is not a link, as in Payload's.
 */
const Trail: React.FC<{
	readonly breadcrumbs: HierarchyViewData['breadcrumbs']
	readonly onOpen: (id: null | number | string) => void
	readonly rootLabel: string
}> = ({ breadcrumbs, onOpen, rootLabel }) => {
	const crumbs = [{ id: null, title: rootLabel }, ...breadcrumbs]
	return (
		<nav aria-label={rootLabel} className={`${baseClass}__trail`}>
			{crumbs.map((crumb, index) => {
				const isLast = index === crumbs.length - 1
				return (
					<React.Fragment key={crumb.id ?? 'root'}>
						{index > 0 ? (
							<span aria-hidden="true" className={`${baseClass}__trail-sep`}>
								/
							</span>
						) : null}
						{isLast ? (
							<span aria-current="page" className={`${baseClass}__trail-current`}>
								{crumb.title}
							</span>
						) : (
							<button
								className={`${baseClass}__trail-link`}
								onClick={() => onOpen(crumb.id)}
								type="button"
							>
								{crumb.title}
							</button>
						)}
					</React.Fragment>
				)
			})}
		</nav>
	)
}

/**
 * Hands the ticked documents to the field, from the header's actions, where Payload's drawer header
 * puts its own confirm button. Like that button it exists for `hasMany` fields only; a single field
 * picks with a click on the row.
 */
const ConfirmSelection: React.FC<{ readonly collectionSlug: string }> = ({ collectionSlug }) => {
	const { getSelectionsForActions } = useDocumentSelection()
	const { onBulkSelect } = useListDrawerContext()
	const { t } = useTranslation()
	const ids = getSelectionsForActions()[collectionSlug]?.ids ?? []

	if (!onBulkSelect) {
		return null
	}
	return (
		<HeaderPortal into=".list-header__actions">
			<Button
				buttonStyle="primary"
				className={`${baseClass}__confirm`}
				disabled={ids.length === 0}
				margin={false}
				onClick={() => onBulkSelect(new Map(ids.map((id) => [id, true])))}
				size="medium"
			>
				{t('general:confirm')}
			</Button>
		</HeaderPortal>
	)
}

/**
 * Payload's hierarchy view, hosted in the list drawer. `renderListView` only builds that view for
 * a hierarchy route, so its data comes from `fetchHierarchyData`, and its navigation runs through a
 * router adapter that turns every URL it pushes into drawer state: a folder link opens the folder,
 * a document link picks the document, search rewrites the query. Nothing it does leaves the
 * document the drawer was opened from.
 */
export const HierarchyBrowser: React.FC<{
	readonly collectionSlug: CollectionSlug
	readonly enableRowSelections?: boolean
	readonly hierarchy: FolderHierarchy
	readonly onStateChange: (state: BrowseState) => void
	readonly state: BrowseState
}> = ({ collectionSlug, enableRowSelections, hierarchy, onStateChange, state }) => {
	const {
		config: {
			routes: { admin: adminRoute, api: apiRoute },
			serverURL,
		},
		getEntityConfig,
	} = useConfig()
	const { permissions } = useAuth()
	const { i18n } = useTranslation()
	const { allowCreate, onSelect } = useListDrawerContext()
	const parentRouter = React.use(RouterAdapterContext)
	const chosen = useChosenUploads(collectionSlug)

	const [data, setData] = React.useState<HierarchyViewData>()
	const [error, setError] = React.useState<unknown>()
	const [reloads, setReloads] = React.useState(0)

	const baseFilter = React.useMemo(
		() =>
			hierarchy.typeFieldName
				? acceptsWhere(hierarchy.typeFieldName, [collectionSlug], hierarchy.typeOptions)
				: undefined,
		[collectionSlug, hierarchy.typeFieldName, hierarchy.typeOptions]
	)
	const chosenKey = [...chosen].sort().join(',')

	React.useEffect(() => {
		// The view calls `router.refresh()` after a create, move or delete; that bumps `reloads`.
		void reloads
		const controller = new AbortController()
		fetchHierarchyData({
			apiRoute,
			baseFilter,
			getEntityConfig,
			hierarchy,
			i18n,
			parentId: state.parentId,
			relatedBaseFilters: {
				[collectionSlug]: notChosenWhere(chosenKey ? chosenKey.split(',') : []),
			},
			relatedSlugs: [collectionSlug],
			search: state.search,
			serverURL,
			signal: controller.signal,
		})
			.then((result) => {
				setData(result)
				setError(undefined)
			})
			.catch((reason: unknown) => {
				if (!controller.signal.aborted) {
					setError(reason)
				}
			})
		return () => controller.abort()
	}, [
		apiRoute,
		baseFilter,
		chosenKey,
		collectionSlug,
		getEntityConfig,
		hierarchy,
		i18n,
		reloads,
		serverURL,
		state.parentId,
		state.search,
	])

	/** Turns a URL the view navigates to into drawer state; false for one that is not the drawer's. */
	const navigate = React.useCallback(
		(href: string): boolean => {
			const url = new URL(href, window.location.origin)
			// Search and the type filter rebuild the URL from the page's own pathname.
			if (url.pathname === window.location.pathname) {
				onStateChange(browseStateFromURL(url, hierarchy.parentFieldName))
				return true
			}
			const segments = url.pathname.slice(adminRoute.length).split('/').filter(Boolean)
			if (segments[0] !== 'collections') {
				return false
			}
			const [, slug, id] = segments
			if (slug === hierarchy.slug && id === undefined) {
				onStateChange(browseStateFromURL(url, hierarchy.parentFieldName))
				return true
			}
			if (slug === collectionSlug && id !== undefined) {
				const docID = decodeURIComponent(id)
				const doc = data?.relatedDocumentsByCollection[collectionSlug]?.result.docs.find(
					(item) => String(item.id) === docID
				)
				onSelect?.({ collectionSlug, doc: doc ?? { id: docID } })
				return true
			}
			// Anything else (a folder's edit page) would leave the document.
			return false
		},
		[adminRoute, collectionSlug, data, hierarchy, onSelect, onStateChange]
	)

	/**
	 * The view's rows are links. On a document with unsaved changes, Payload's leave-without-saving
	 * guard catches every link click on `document` in the capture phase, ahead of the link's own
	 * handler, and asks before a navigation that never happens. A capture listener on `window` runs
	 * first, so plain clicks on the drawer's own links are handled here; any other link still goes
	 * through the guard.
	 */
	const root = React.useRef<HTMLDivElement>(null)
	React.useEffect(() => {
		const onClick = (event: MouseEvent) => {
			if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
				return
			}
			const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
			if (!(anchor instanceof HTMLAnchorElement) || !root.current?.contains(anchor)) {
				return
			}
			if (navigate(anchor.href)) {
				event.preventDefault()
				event.stopPropagation()
			}
		}
		window.addEventListener('click', onClick, true)
		return () => window.removeEventListener('click', onClick, true)
	}, [navigate])

	const router = React.useMemo<RouterAdapterRouter>(
		() => ({
			...parentRouter.router,
			push: (href: string) => void navigate(href),
			refresh: () => setReloads((count) => count + 1),
			replace: (href: string) => void navigate(href),
		}),
		[navigate, parentRouter.router]
	)

	const adapter = React.useMemo(
		() => ({
			...parentRouter,
			router,
			searchParams: browseStateToParams(state, hierarchy.parentFieldName),
		}),
		[hierarchy.parentFieldName, parentRouter, router, state]
	)

	if (error) {
		throw error
	}
	if (!data) {
		return null
	}

	const folderConfig = getEntityConfig({ collectionSlug: hierarchy.slug })
	const folderPermissions = permissions?.collections?.[hierarchy.slug]
	const parent = data.parent
	const props = {
		baseFilter,
		collectionSlug: hierarchy.slug as CollectionSlug,
		currentHierarchyItem:
			parent && state.parentId !== null
				? {
						id: state.parentId,
						// No edit gear beside the title: the drawer picks, it does not manage folders.
						hasUpdatePermission: false,
						title: String(parent[hierarchy.useAsTitle] ?? state.parentId),
					}
				: undefined,
		Description: (
			<div className={`${baseClass}__subheader`}>
				<HeaderPortal into=".list-header__title-and-actions">
					<Trail
						breadcrumbs={data.breadcrumbs}
						onOpen={(parentId) => onStateChange({ ...state, parentId, search: '' })}
						rootLabel={getTranslation(folderConfig?.labels?.plural ?? hierarchy.slug, i18n)}
					/>
				</HeaderPortal>
				<CollectionSelect />
				{enableRowSelections ? <ConfirmSelection collectionSlug={collectionSlug} /> : null}
			</div>
		),
		hasCreatePermission: allowCreate !== false && Boolean(folderPermissions?.create),
		hierarchyData: data,
		viewType: 'hierarchy',
	} satisfies Partial<ListViewClientProps> as ListViewClientProps

	return (
		<div className={baseClass} ref={root}>
			<RouterAdapterContext value={adapter}>
				{/* Below the adapter, so the view's `clearRouteCache` reloads this data, not the page. */}
				<RouteCacheProvider>
					<HierarchyListView {...props} />
				</RouteCacheProvider>
			</RouterAdapterContext>
		</div>
	)
}
