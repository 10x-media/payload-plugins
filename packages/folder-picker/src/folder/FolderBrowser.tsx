'use client'

import { getTranslation } from '@payloadcms/translations'
import {
	Button,
	FolderIcon,
	FolderProvider,
	Gutter,
	LoadingOverlay,
	Popup,
	PopupList,
	useAuth,
	useConfig,
	useDocumentDrawer,
	useListDrawerContext,
	useServerFunctions,
	useTranslation,
	useWindowInfo,
} from '@payloadcms/ui'
import type { CollectionSlug, FolderSortKeys } from 'payload'
import type { FolderBreadcrumb, FolderOrDocument } from 'payload/shared'
import React from 'react'
import { BulkUploadButton, SelectManyFolderItems } from './BulkUploadButton'
import type { FolderActionHandlers } from './FolderActions'
import { FolderActionsMenu, FolderSelectionBar } from './FolderActions'
import {
	CloseModalButton,
	ListHeader,
	NoListResults,
	SearchBar,
	SortByPill,
	ToggleViewButtons,
} from './native'

const baseClass = 'collection-folder-list'

type FolderBrowserProps = {
	readonly collectionSlug: CollectionSlug
	/** The upload field sets this from `hasMany`, so it is the honest test for a multi-file flow. */
	readonly enableRowSelections?: boolean
	readonly Tabs?: React.ReactNode
}

/**
 * Folder picker for the list drawer, composed the way `DefaultCollectionFolderView` composes the
 * route view. That view changes folder by pushing an admin route, which would tear a drawer down,
 * so this drives `get-folder-results-component-and-data` directly the way Payload's own
 * MoveToFolder drawer does and keeps the current folder in local state.
 */
export const FolderBrowser: React.FC<FolderBrowserProps> = ({
	collectionSlug,
	enableRowSelections,
	Tabs,
}) => {
	const { config, getEntityConfig } = useConfig()
	const { permissions } = useAuth()
	const { i18n, t } = useTranslation()
	const { getFolderResultsComponentAndData } = useServerFunctions()
	const { drawerSlug, onSelect } = useListDrawerContext()
	const {
		breakpoints: { s: smallBreak },
	} = useWindowInfo()

	const folderCollectionSlug = config.folders ? (config.folders.slug as CollectionSlug) : undefined
	const folderFieldName = config.folders ? config.folders.fieldName : undefined
	const folderCollectionConfig = folderCollectionSlug
		? getEntityConfig({ collectionSlug: folderCollectionSlug })
		: undefined
	const targetConfig = getEntityConfig({ collectionSlug })

	const [folderID, setFolderID] = React.useState<null | number | string>(null)
	const [breadcrumbs, setBreadcrumbs] = React.useState<FolderBreadcrumb[]>([])
	const [subfolders, setSubfolders] = React.useState<FolderOrDocument[]>([])
	const [documents, setDocuments] = React.useState<FolderOrDocument[]>([])
	const [ResultsComponent, setResultsComponent] = React.useState<React.ReactNode>(null)
	const [hasLoaded, setHasLoaded] = React.useState(false)
	const [displayAs, setDisplayAs] = React.useState<'grid' | 'list'>('grid')
	const [sort, setSort] = React.useState<FolderSortKeys>('name')
	const [search, setSearch] = React.useState('')

	const loadFolder = React.useCallback(
		async (args: {
			displayAs: 'grid' | 'list'
			folderID: null | number | string
			sort: FolderSortKeys
		}) => {
			if (!folderCollectionSlug) return

			const result = await getFolderResultsComponentAndData({
				browseByFolder: false,
				// The folders collection has to be listed here or getFolderResultsComponentAndData
				// never builds its folderWhere, and no subfolder is ever returned.
				collectionsToDisplay: [folderCollectionSlug, collectionSlug],
				displayAs: args.displayAs,
				folderAssignedCollections: [collectionSlug],
				folderID: args.folderID ?? undefined,
				sort: args.sort,
			})

			setBreadcrumbs(result?.breadcrumbs || [])
			setSubfolders(result?.subfolders || [])
			setDocuments(result?.documents || [])
			setResultsComponent(result?.FolderResultsComponent || null)
			setFolderID(args.folderID)
			setHasLoaded(true)
		},
		[collectionSlug, folderCollectionSlug, getFolderResultsComponentAndData]
	)

	const reload = React.useCallback(
		() => loadFolder({ displayAs, folderID, sort }),
		[displayAs, folderID, loadFolder, sort]
	)

	const actionHandlersRef = React.useRef<FolderActionHandlers | null>(null)
	const hasRequestedRef = React.useRef(false)
	React.useEffect(() => {
		if (!hasRequestedRef.current) {
			hasRequestedRef.current = true
			void loadFolder({ displayAs: 'grid', folderID: null, sort: 'name' })
		}
	}, [loadFolder])

	const currentFolder = breadcrumbs[breadcrumbs.length - 1]
	const parentFolder = breadcrumbs[breadcrumbs.length - 2]

	const [
		CreateFolderDrawer,
		,
		{ closeDrawer: closeCreateFolderDrawer, openDrawer: openCreateFolderDrawer },
	] = useDocumentDrawer({ collectionSlug: folderCollectionSlug ?? '' })

	const [
		CreateDocumentDrawer,
		,
		{ closeDrawer: closeCreateDocumentDrawer, openDrawer: openCreateDocumentDrawer },
	] = useDocumentDrawer({ collectionSlug })

	const handleItemClick = React.useCallback(
		async (item: FolderOrDocument) => {
			if (item.relationTo === folderCollectionSlug) {
				await loadFolder({ displayAs, folderID: item.value.id, sort })
				return
			}

			// The upload field re-fetches from the id, so the folder item's partial doc is enough.
			onSelect?.({
				collectionSlug: item.relationTo,
				doc: item.value,
				docID: String(item.value.id),
			})
		},
		[displayAs, folderCollectionSlug, loadFolder, onSelect, sort]
	)

	if (!folderCollectionSlug || !folderFieldName) {
		return null
	}

	if (!hasLoaded) {
		return <LoadingOverlay />
	}

	// The server function takes no search argument (the route view reads it off the request), so the
	// current folder's contents are narrowed in the browser instead. Same scope, no round trip.
	const term = search.trim().toLowerCase()
	const matches = (item: FolderOrDocument) =>
		!term ||
		String(item.value._folderOrDocumentTitle ?? '')
			.toLowerCase()
			.includes(term)
	const visibleSubfolders = subfolders.filter(matches)
	const visibleDocuments = documents.filter(matches)
	const totalVisible = visibleSubfolders.length + visibleDocuments.length

	const folderLabel = getTranslation(folderCollectionConfig?.labels?.singular ?? '', i18n)
	const pluralLabel = getTranslation(targetConfig?.labels?.plural ?? collectionSlug, i18n)
	const canCreateFolder = Boolean(permissions?.collections?.[folderCollectionSlug]?.create)
	// A document needs a folder to live in, so it is only creatable once inside one. Mirrors the
	// route view, where the root offers folders alone and nested folders offer both.
	const canCreateDocument =
		Boolean(permissions?.collections?.[collectionSlug]?.create) && folderID !== null

	const creatable = [
		canCreateFolder
			? { label: folderLabel, onClick: openCreateFolderDrawer, slug: folderCollectionSlug }
			: null,
		canCreateDocument
			? {
					label: getTranslation(targetConfig?.labels?.singular ?? collectionSlug, i18n),
					onClick: openCreateDocumentDrawer,
					slug: collectionSlug,
				}
			: null,
	].filter(Boolean) as { label: string; onClick: () => void; slug: string }[]

	// One option renders as a plain button, several as a chevron popup, the same shape
	// ListCreateNewDocInFolderButton uses. Read out rather than indexed twice, so
	// noUncheckedIndexedAccess narrows once for the whole branch.
	const [onlyCreatable] = creatable

	const createAction =
		creatable.length === 0 ? null : onlyCreatable && creatable.length === 1 ? (
			<Button
				buttonStyle="pill"
				el="div"
				key="create-new"
				onClick={onlyCreatable.onClick}
				size="small"
			>
				{`${t('general:create')} ${onlyCreatable.label.toLowerCase()}`}
			</Button>
		) : (
			<Popup
				button={
					<Button buttonStyle="pill" el="div" icon="chevron" size="small">
						{t('general:createNew')}
					</Button>
				}
				buttonType="default"
				key="create-new"
			>
				<PopupList.ButtonGroup>
					{creatable.map((option) => (
						<PopupList.Button key={option.slug} onClick={option.onClick}>
							{option.label}
						</PopupList.Button>
					))}
				</PopupList.ButtonGroup>
			</Popup>
		)
	const crumbs = [{ id: null, name: pluralLabel }, ...breadcrumbs]

	// Sits in the title row rather than a row of its own, so entering a folder does not shift
	// everything below it down.
	const trail =
		breadcrumbs.length > 0 ? (
			<nav aria-label={pluralLabel} className={`${baseClass}__trail`} key="breadcrumbs">
				<FolderIcon />
				{crumbs.map((crumb, index) => (
					<React.Fragment key={String(crumb.id ?? 'root')}>
						{index > 0 && (
							<span aria-hidden="true" className={`${baseClass}__trail-sep`}>
								/
							</span>
						)}
						<Button
							buttonStyle="none"
							className={`${baseClass}__trail-crumb`}
							el="button"
							onClick={() => {
								void loadFolder({ displayAs, folderID: crumb.id, sort })
							}}
						>
							{crumb.name}
						</Button>
					</React.Fragment>
				))}
			</nav>
		) : null

	return (
		<div className={`${baseClass} ${baseClass}--${collectionSlug}`}>
			{Tabs || trail ? (
				<Gutter className="default-list-view-tabs__drawer-gutter">
					<div className={`${baseClass}__tabs-row`}>
						{Tabs}
						{trail}
					</div>
				</Gutter>
			) : null}

			<FolderProvider
				allCollectionFolderSlugs={[folderCollectionSlug]}
				allowCreateCollectionSlugs={canCreateFolder ? [folderCollectionSlug] : []}
				allowMultiSelection
				breadcrumbs={breadcrumbs}
				documents={visibleDocuments}
				folderFieldName={folderFieldName}
				folderID={folderID ?? undefined}
				FolderResultsComponent={ResultsComponent}
				key={`${String(folderID)}-${displayAs}`}
				onItemClick={handleItemClick}
				subfolders={visibleSubfolders}
			>
				<Gutter className={`${baseClass}__wrap`}>
					<ListHeader
						Actions={[
							// Hidden on small screens, where the actions menu in the search bar is the
							// usable form. Both are available above that break, as in the route view.
							smallBreak ? null : (
								<FolderSelectionBar
									collectionSlug={collectionSlug}
									currentFolderName={String(currentFolder?.name ?? '')}
									handlersRef={actionHandlersRef}
									folderCollectionSlug={folderCollectionSlug}
									folderFieldName={folderFieldName}
									key="selection-bar"
									onChanged={(next: null | number | string) =>
										loadFolder({ displayAs, folderID: next, sort })
									}
									parentFolderID={parentFolder?.id ?? undefined}
								/>
							),
							drawerSlug ? (
								<CloseModalButton
									className="list-drawer__header-close"
									key="close-button"
									slug={drawerSlug}
								/>
							) : null,
						].filter(Boolean)}
						// Same class the drawer's own list header carries, so both views lay their header
						// out identically and the close button lands in the same place.
						className="list-drawer__header"
						title={pluralLabel}
						TitleActions={[
							createAction,
							<BulkUploadButton
								collectionSlug={collectionSlug}
								enableRowSelections={enableRowSelections}
								folderID={folderID}
								key="bulk-upload"
							/>,
						].filter(Boolean)}
					/>

					<SearchBar
						Actions={[
							<SelectManyFolderItems
								collectionSlug={collectionSlug}
								enableRowSelections={enableRowSelections}
								key="select-many"
							/>,
							<SortByPill
								key="sort-by-pill"
								onChange={(next) => {
									setSort(next)
									void loadFolder({ displayAs, folderID, sort: next })
								}}
								sort={sort}
								t={t as unknown as (key: string) => string}
							/>,
							<ToggleViewButtons
								activeView={displayAs}
								key="toggle-view-buttons"
								setActiveView={(view) => {
									setDisplayAs(view)
									void loadFolder({ displayAs: view, folderID, sort })
								}}
							/>,
							<FolderActionsMenu
								collectionSlug={collectionSlug}
								currentFolderName={String(currentFolder?.name ?? '')}
								handlersRef={actionHandlersRef}
								folderCollectionSlug={folderCollectionSlug}
								folderFieldName={folderFieldName}
								key="current-folder-actions"
								onChanged={(next: null | number | string) =>
									loadFolder({ displayAs, folderID: next, sort })
								}
								parentFolderID={parentFolder?.id ?? undefined}
							/>,
						].filter(Boolean)}
						label={t('general:searchBy', { label: t('general:name') })}
						onSearchChange={setSearch}
					/>

					{totalVisible > 0 ? (
						ResultsComponent
					) : (
						<NoListResults
							Actions={[
								canCreateFolder ? (
									<Button
										buttonStyle="primary"
										el="button"
										key="create-folder"
										onClick={openCreateFolderDrawer}
										size="medium"
									>
										{`${t('general:create')} ${folderLabel.toLowerCase()}`}
									</Button>
								) : null,
								canCreateDocument ? (
									<Button
										buttonStyle="primary"
										el="button"
										key="create-document"
										onClick={openCreateDocumentDrawer}
										size="medium"
									>
										{`${t('general:create')} ${t('general:document').toLowerCase()}`}
									</Button>
								) : null,
							].filter(Boolean)}
							Message={
								<>
									<h3>{t('general:noResultsFound')}</h3>
									<p>{t('general:noResultsDescription')}</p>
								</>
							}
						/>
					)}

					{/* Mirrors ListCreateNewDocInFolderButton: a new folder lands in the folder being
					viewed and is typed to the collection this drawer is picking for, so the editor
					never has to set Folder Type by hand. */}
					<CreateFolderDrawer
						initialData={{ [folderFieldName]: folderID, folderType: [collectionSlug] }}
						onSave={async () => {
							closeCreateFolderDrawer()
							await reload()
						}}
						redirectAfterCreate={false}
					/>
					<CreateDocumentDrawer
						initialData={{ [folderFieldName]: folderID }}
						onSave={async () => {
							closeCreateDocumentDrawer()
							await reload()
						}}
						redirectAfterCreate={false}
					/>
				</Gutter>
			</FolderProvider>
		</div>
	)
}
