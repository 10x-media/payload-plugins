'use client'

import { DndContext, type DragEndEvent, pointerWithin } from '@dnd-kit/core'
import { getTranslation } from '@payloadcms/translations'
import {
	Button,
	FolderIcon,
	FolderProvider,
	Gutter,
	ItemCardGrid,
	LoadingOverlay,
	Popup,
	PopupList,
	toast,
	useAuth,
	useConfig,
	useDebounce,
	useDocumentDrawer,
	useFolder,
	useListDrawerContext,
	useServerFunctions,
	useWindowInfo,
} from '@payloadcms/ui'
import type { CollectionSlug, FolderSortKeys } from 'payload'
import type { FolderBreadcrumb, FolderOrDocument } from 'payload/shared'
import React from 'react'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { BulkUploadButton, SelectFolderItems } from './BulkUploadButton'
import type { FolderActionHandlers } from './FolderActions'
import { FolderActionsMenu, FolderSelectionBar } from './FolderActions'
import { isMacPlatform, modifierLabels } from './isMacPlatform'
import {
	CloseModalButton,
	DndEventListener,
	DragOverlaySelection,
	DrawerRelationshipSelect,
	ListHeader,
	NoListResults,
	SearchBar,
	SortByPill,
	ToggleViewButtons,
} from './native'
import { useChosenUploads } from './useChosenUploads'

const baseClass = 'collection-folder-list'

/**
 * Dragging, the way the route view wires it: a listener that turns a drop into a move, and the card
 * that follows the cursor. Lives inside the provider because that is where the selection and
 * `moveToFolder` are, and reloads rather than clearing the route cache, since a drawer changes no
 * route.
 */
const FolderDragLayer: React.FC<{ readonly onMoved: () => Promise<void> }> = ({ onMoved }) => {
	const { dragOverlayItem, getSelectedItems, moveToFolder, selectedItemKeys, setIsDragging } =
		useFolder()

	const handleDragEnd = React.useCallback(
		async (event: DragEndEvent) => {
			const target = event.over?.data.current
			if (target?.type !== 'folder' || !('id' in target)) {
				return
			}

			await moveToFolder({ itemsToMove: getSelectedItems?.() ?? [], toFolderID: target.id })
			await onMoved()
		},
		[getSelectedItems, moveToFolder, onMoved]
	)

	return (
		<React.Fragment>
			<DndEventListener onDragEnd={handleDragEnd} setIsDragging={setIsDragging} />
			{selectedItemKeys.size > 0 && dragOverlayItem ? (
				<DragOverlaySelection
					selectedCount={selectedItemKeys.size}
					title={String(dragOverlayItem.value._folderOrDocumentTitle ?? '')}
				/>
			) : null}
		</React.Fragment>
	)
}

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
	const alreadyChosen = useChosenUploads(collectionSlug)
	const {
		breakpoints: { s: smallBreak },
	} = useWindowInfo()

	const folderCollectionSlug = config.folders ? (config.folders.slug as CollectionSlug) : undefined
	const folderFieldName = config.folders ? config.folders.fieldName : undefined
	const folderCollectionConfig = folderCollectionSlug
		? getEntityConfig({ collectionSlug: folderCollectionSlug })
		: undefined
	const targetConfig = getEntityConfig({ collectionSlug })

	// Read after mount: `navigator` does not exist while the tree is rendered on the server,
	// and branching on it during the first client render would not match what was sent.
	const [isMac, setIsMac] = React.useState(false)
	React.useEffect(() => {
		setIsMac(isMacPlatform(navigator.userAgent))
	}, [])

	const [folderID, setFolderID] = React.useState<null | number | string>(null)
	const [breadcrumbs, setBreadcrumbs] = React.useState<FolderBreadcrumb[]>([])
	const [subfolders, setSubfolders] = React.useState<FolderOrDocument[]>([])
	const [documents, setDocuments] = React.useState<FolderOrDocument[]>([])
	const [ResultsComponent, setResultsComponent] = React.useState<React.ReactNode>(null)
	const [loadedFor, setLoadedFor] = React.useState<CollectionSlug | null>(null)
	const [loadError, setLoadError] = React.useState(false)
	const [displayAs, setDisplayAs] = React.useState<'grid' | 'list'>('grid')
	const [sort, setSort] = React.useState<FolderSortKeys>('name')
	const [searchInput, setSearchInput] = React.useState('')
	// The typed text lives here rather than in the input, which is rebuilt with the provider on
	// every view or folder change. Debounced here for the same reason.
	const search = useDebounce(searchInput, 300)

	/**
	 * Breadcrumbs, cards, the sort pill, the view toggle and the mount effect all load, and each
	 * load writes six pieces of state. A slow early request resolving after a fast later one would
	 * otherwise put one folder's contents under another folder's breadcrumb, so every response
	 * checks that it is still the one being waited for.
	 */
	const latestRequest = React.useRef(0)

	const loadFolder = React.useCallback(
		async (args: {
			displayAs: 'grid' | 'list'
			folderID: null | number | string
			sort: FolderSortKeys
		}) => {
			if (!folderCollectionSlug) return

			const request = ++latestRequest.current

			try {
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

				if (request !== latestRequest.current) return

				setLoadError(false)
				setBreadcrumbs(result?.breadcrumbs || [])
				setSubfolders(result?.subfolders || [])
				setDocuments(result?.documents || [])
				setResultsComponent(result?.FolderResultsComponent || null)
				setFolderID(args.folderID)
				setLoadedFor(collectionSlug)
			} catch (error) {
				if (request !== latestRequest.current) return

				// Every call site fires this and forgets it, so a rejection would surface as nothing but
				// an unhandled promise while the drawer sat under its loading overlay for good.
				toast.error(error instanceof Error ? error.message : String(error))
				setLoadError(true)
				setLoadedFor(collectionSlug)
			}
		},
		[collectionSlug, folderCollectionSlug, getFolderResultsComponentAndData]
	)

	const reload = React.useCallback(
		() => loadFolder({ displayAs, folderID, sort }),
		[displayAs, folderID, loadFolder, sort]
	)

	const actionHandlersRef = React.useRef<FolderActionHandlers | null>(null)
	// The drawer's collection select re-renders this view in place rather than remounting it, so a
	// switch has to be caught here. Requesting per collection rather than once also keeps the effect
	// idempotent, which the toggles below rely on since they load on their own.
	const requestedFor = React.useRef<CollectionSlug | null>(null)
	React.useEffect(() => {
		if (requestedFor.current !== collectionSlug) {
			requestedFor.current = collectionSlug
			void loadFolder({ displayAs, folderID: null, sort })
		}
	}, [collectionSlug, displayAs, loadFolder, sort])

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

	// Only the very first load has nothing to draw. A collection switch keeps the header up and
	// swaps the results alone, since blanking a drawer the user is still reading it looks like it
	// closed and reopened.
	if (loadedFor === null) {
		return <LoadingOverlay />
	}

	const isSwitchingCollection = loadedFor !== collectionSlug

	// The server function takes no search argument (the route view reads it off the request), so the
	// current folder's contents are narrowed in the browser instead. Same scope, no round trip.
	const term = search.trim().toLowerCase()
	const matches = (item: FolderOrDocument) =>
		!term ||
		String(item.value._folderOrDocumentTitle ?? '')
			.toLowerCase()
			.includes(term)
	const visibleSubfolders = subfolders.filter(matches)
	/**
	 * A document the field already holds is dropped, the way Payload's own list tab drops it:
	 * the upload field builds `filterOptions` with `id: { not_in: [...] }` from its value, so a
	 * file that is already attached never appears among the options. The folder server function
	 * takes no filter argument, so the same rule is applied to what came back.
	 *
	 * Without it the file can be picked a second time, and the upload field appends whatever it
	 * is handed, storing the same upload twice.
	 */
	const visibleDocuments = documents.filter(
		(item) =>
			matches(item) &&
			!(item.relationTo === collectionSlug && alreadyChosen.has(String(item.value.id)))
	)
	const totalVisible = visibleSubfolders.length + visibleDocuments.length

	const folderLabel = getTranslation(folderCollectionConfig?.labels?.singular ?? '', i18n)
	const folderPluralLabel = getTranslation(folderCollectionConfig?.labels?.plural ?? '', i18n)
	const pluralLabel = getTranslation(targetConfig?.labels?.plural ?? collectionSlug, i18n)

	/**
	 * The server bakes the items into its grid, so narrowing the provider reaches the table view
	 * alone and the grid keeps drawing everything: searching would leave the count and the cards
	 * disagreeing. The grid is rebuilt here from the same filtered arrays, using the card grid
	 * Payload builds it from, so only the data differs. The table needs none of this because it
	 * takes no items and reads the provider itself.
	 */
	const Results =
		displayAs === 'grid' ? (
			<div>
				{visibleSubfolders.length ? (
					<ItemCardGrid items={visibleSubfolders} title={folderPluralLabel} type="folder" />
				) : null}
				{visibleDocuments.length ? (
					<ItemCardGrid
						items={visibleDocuments}
						subfolderCount={visibleSubfolders.length}
						title={pluralLabel}
						type="file"
					/>
				) : null}
			</div>
		) : (
			ResultsComponent
		)
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

	// A document view wraps its children in LivePreviewProvider, whose DndContext looks up a
	// `live-preview-area` droppable and hands the result to rectIntersection unchecked. In a drawer
	// that area does not exist, so the first pointer move throws. Registering the cards here keeps
	// them out of that context, and matches the collision detection the admin root uses.
	return (
		<DndContext collisionDetection={pointerWithin}>
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
					// Only a `hasMany` field can take more than one document. Left on, Ctrl and Shift
					// build a selection the field cannot accept, and the confirm pill counts files
					// that will never be added.
					allowMultiSelection={Boolean(enableRowSelections)}
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
							AfterListHeaderContent={<DrawerRelationshipSelect />}
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
								<SelectFolderItems
									collectionSlug={collectionSlug}
									enableRowSelections={enableRowSelections}
									key="select-items"
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
							onSearchChange={setSearchInput}
							search={searchInput}
						/>
						{enableRowSelections ? (
							<p className={`${baseClass}__pick-many-hint`}>
								{t(keys.pickManyHint, modifierLabels(isMac))}
							</p>
						) : null}
						{isSwitchingCollection ? (
							<LoadingOverlay />
						) : loadError ? (
							<NoListResults
								Actions={[
									<Button
										buttonStyle="primary"
										el="button"
										key="retry"
										onClick={() => void reload()}
										size="medium"
									>
										{t(keys.retry)}
									</Button>,
								]}
								Message={<p>{t('error:unknown')}</p>}
							/>
						) : totalVisible > 0 ? (
							Results
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
						<FolderDragLayer onMoved={reload} />
					</Gutter>
				</FolderProvider>
			</div>
		</DndContext>
	)
}
