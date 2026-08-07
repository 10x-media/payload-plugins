'use client'

import { type DragEndEvent, DragOverlay, type Modifier, useDndMonitor } from '@dnd-kit/core'
import { getTranslation } from '@payloadcms/translations'
import {
	Button,
	ChevronIcon,
	FieldLabel,
	FolderIcon,
	GridViewIcon,
	ListViewIcon,
	Pill,
	Popup,
	PopupList,
	ReactSelect,
	SearchIcon,
	useConfig,
	useDebounce,
	useListDrawerContext,
	useModal,
	useTranslation,
	XIcon,
} from '@payloadcms/ui'
import type { FolderSortKeys } from 'payload'
import React from 'react'

/**
 * Faithful copies of the folder view's header pieces. `ListHeader`, `SearchBar`, `SearchFilter`,
 * `SortByPill`, `ToggleViewButtons` and `NoListResults` are all internal to @payloadcms/ui, but the
 * admin loads that package's whole stylesheet through `@payloadcms/next/css`, so reproducing their
 * markup and class names reproduces their appearance exactly. Only the behaviour differs: these
 * take callbacks instead of pushing an admin route, which a drawer cannot survive.
 */

export const listHeaderClass = 'list-header'

export const ListHeader: React.FC<{
	readonly Actions?: React.ReactNode[]
	readonly AfterListHeaderContent?: React.ReactNode
	readonly className?: string
	readonly title: string
	readonly TitleActions?: React.ReactNode[]
}> = ({ Actions = [], AfterListHeaderContent, className, title, TitleActions = [] }) => (
	<header className={[listHeaderClass, className].filter(Boolean).join(' ')}>
		<div className={`${listHeaderClass}__content`}>
			<div className={`${listHeaderClass}__title-and-actions`}>
				<h1 className={`${listHeaderClass}__title`}>{title}</h1>
				{TitleActions.length ? (
					<div className={`${listHeaderClass}__title-actions`}>{TitleActions}</div>
				) : null}
			</div>
			{Actions.length ? <div className={`${listHeaderClass}__actions`}>{Actions}</div> : null}
		</div>
		{AfterListHeaderContent ? (
			<div className={`${listHeaderClass}__after-header-content`}>{AfterListHeaderContent}</div>
		) : null}
	</header>
)

/**
 * Copy of the internal `DrawerRelationshipSelect`, which the drawer's list header renders for a
 * polymorphic upload field and hides when only one collection is allowed. Picking an option calls
 * the drawer's own `setSelectedOption`, which re-renders the list server side for that collection,
 * so switching needs nothing from the folder view itself.
 */
export const DrawerRelationshipSelect: React.FC = () => {
	const { config } = useConfig()
	const { enabledCollections, selectedOption, setSelectedOption } = useListDrawerContext()
	const { i18n, t } = useTranslation()

	const enabled = config.collections.filter(({ slug }) => enabledCollections?.includes(slug))

	if (enabled.length < 2) {
		return null
	}

	const active = enabled.find(({ slug }) => slug === selectedOption?.value)

	return (
		<div className="list-drawer__select-collection-wrap">
			<FieldLabel label={t('upload:selectCollectionToBrowse')} />
			<ReactSelect
				className={`${listHeaderClass}__select-collection`}
				isClearable={false}
				onChange={(option) => {
					const picked = Array.isArray(option) ? option[0] : option
					const target = enabled.find(({ slug }) => slug === picked?.value)

					if (target) {
						setSelectedOption?.({
							label: getTranslation(target.labels.singular, i18n),
							value: target.slug,
						})
					}
				}}
				options={enabled.map((collection) => ({
					label: getTranslation(collection.labels.singular, i18n),
					value: collection.slug,
				}))}
				value={{
					label: active ? getTranslation(active.labels.singular, i18n) : '',
					value: active?.slug,
				}}
			/>
		</div>
	)
}

/** Copy of the internal CloseModalButton the drawer's list header renders. */
export const CloseModalButton: React.FC<{ readonly className?: string; readonly slug: string }> = ({
	className,
	slug,
}) => {
	const { closeModal } = useModal()
	const { t } = useTranslation()

	return (
		<button
			aria-label={t('general:close')}
			className={['close-modal-button', className].filter(Boolean).join(' ')}
			onClick={() => closeModal(slug)}
			type="button"
		>
			<XIcon />
		</button>
	)
}

/** Copy of the internal Dots icon the folder actions menu uses as its trigger. */
export const Dots: React.FC<{ readonly ariaLabel?: string }> = ({ ariaLabel }) => (
	<div aria-label={ariaLabel} className="dots dots--vertical" role="img">
		<div />
		<div />
		<div />
	</div>
)

const searchFilterClass = 'search-filter'

const SearchFilter: React.FC<{
	readonly label: string
	readonly onChange: (search: string) => void
}> = ({ label, onChange }) => {
	const [search, setSearch] = React.useState('')
	const debounced = useDebounce(search, 300)
	const previous = React.useRef('')

	React.useEffect(() => {
		if (debounced !== previous.current) {
			previous.current = debounced
			onChange(debounced)
		}
	}, [debounced, onChange])

	return (
		<div className={searchFilterClass}>
			<input
				aria-label={label}
				className={`${searchFilterClass}__input`}
				id="search-filter-input"
				onChange={(event) => setSearch(event.target.value)}
				placeholder={label}
				type="text"
				value={search}
			/>
		</div>
	)
}

const searchBarClass = 'search-bar'

export const SearchBar: React.FC<{
	readonly Actions?: React.ReactNode[]
	readonly label: string
	readonly onSearchChange: (search: string) => void
}> = ({ Actions = [], label, onSearchChange }) => (
	<div className={searchBarClass}>
		<SearchIcon />
		<SearchFilter label={label} onChange={onSearchChange} />
		{Actions.length ? <div className={`${searchBarClass}__actions`}>{Actions}</div> : null}
	</div>
)

const toggleClass = 'folder-view-toggle-button'

export const ToggleViewButtons: React.FC<{
	readonly activeView: 'grid' | 'list'
	readonly setActiveView: (view: 'grid' | 'list') => void
}> = ({ activeView, setActiveView }) => (
	<React.Fragment>
		<Button
			buttonStyle="pill"
			className={[toggleClass, activeView === 'grid' && `${toggleClass}--active`]
				.filter(Boolean)
				.join(' ')}
			icon={<GridViewIcon />}
			margin={false}
			onClick={() => setActiveView('grid')}
		/>
		<Button
			buttonStyle="pill"
			className={[toggleClass, activeView === 'list' && `${toggleClass}--active`]
				.filter(Boolean)
				.join(' ')}
			icon={<ListViewIcon />}
			margin={false}
			onClick={() => setActiveView('list')}
		/>
	</React.Fragment>
)

const SortDownIcon: React.FC<{ className?: string }> = ({ className }) => (
	<svg
		aria-hidden="true"
		className={['icon icon--sort', className].filter(Boolean).join(' ')}
		fill="none"
		height="20"
		viewBox="0 0 20 20"
		width="20"
		xmlns="http://www.w3.org/2000/svg"
	>
		<path
			className="fill"
			d="M2.5 13.3333L5.83333 16.6667M5.83333 16.6667L9.16667 13.3333M5.83333 16.6667V3.33333M9.16667 7.08333H17.5M9.16667 10.4167H15M11.6667 13.75H12.5"
			stroke="#2F2F2F"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
)

const SortUpIcon: React.FC<{ className?: string }> = ({ className }) => (
	<svg
		aria-hidden="true"
		className={['icon icon--sort', className].filter(Boolean).join(' ')}
		fill="none"
		height="20"
		viewBox="0 0 20 20"
		width="20"
		xmlns="http://www.w3.org/2000/svg"
	>
		<path
			className="fill"
			d="M2.5 6.66668L5.83333 3.33334M5.83333 3.33334L9.16667 6.66668M5.83333 3.33334V16.6667M11.6667 7.08354H17.5M9.16667 10.4169H15M9.16667 13.7502H12.5"
			stroke="#2F2F2F"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
)

const sortClass = 'sort-by-pill'

const SORT_FIELDS: { key: 'createdAt' | 'name' | 'updatedAt'; label: string }[] = [
	{ key: 'name', label: 'general:name' },
	{ key: 'createdAt', label: 'general:createdAt' },
	{ key: 'updatedAt', label: 'general:updatedAt' },
]

export const SortByPill: React.FC<{
	readonly onChange: (sort: FolderSortKeys) => void
	readonly sort: FolderSortKeys
	readonly t: (key: string) => string
}> = ({ onChange, sort, t }) => {
	const descending = sort.startsWith('-')
	const field = sort.replace('-', '') as 'createdAt' | 'name' | 'updatedAt'
	const activeLabel = SORT_FIELDS.find((option) => option.key === field)?.label ?? 'general:name'

	return (
		<Popup
			button={
				<Pill className={`${sortClass}__trigger`} icon={<ChevronIcon />} size="small">
					{descending ? (
						<SortDownIcon className={`${sortClass}__sort-icon`} />
					) : (
						<SortUpIcon className={`${sortClass}__sort-icon`} />
					)}
					{t(activeLabel)}
				</Pill>
			}
			className={sortClass}
			horizontalAlign="right"
			render={({ close }) => (
				<React.Fragment>
					<PopupList.GroupLabel label="Sort by" />
					<PopupList.ButtonGroup>
						{SORT_FIELDS.map((option) => (
							<PopupList.Button
								active={field === option.key}
								key={option.key}
								onClick={() => {
									onChange((descending ? `-${option.key}` : option.key) as FolderSortKeys)
									close()
								}}
							>
								{t(option.label)}
							</PopupList.Button>
						))}
					</PopupList.ButtonGroup>
					<PopupList.Divider />
					<PopupList.GroupLabel label="Order" />
					<PopupList.ButtonGroup>
						<PopupList.Button
							active={!descending}
							className={`${sortClass}__order-option`}
							onClick={() => {
								onChange(field as FolderSortKeys)
								close()
							}}
						>
							<SortUpIcon />
							{t('general:ascending')}
						</PopupList.Button>
						<PopupList.Button
							active={descending}
							className={`${sortClass}__order-option`}
							onClick={() => {
								onChange(`-${field}` as FolderSortKeys)
								close()
							}}
						>
							<SortDownIcon />
							{t('general:descending')}
						</PopupList.Button>
					</PopupList.ButtonGroup>
				</React.Fragment>
			)}
			size="medium"
		/>
	)
}

const noResultsClass = 'no-results'

export const NoListResults: React.FC<{
	readonly Actions?: React.ReactNode[]
	readonly Message: React.ReactNode
}> = ({ Actions = [], Message }) => (
	<div className={noResultsClass}>
		{Message}
		{Actions.length > 0 && (
			<div className={`${noResultsClass}__actions`}>
				{Actions.map((action, index) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: mirrors Payload's own NoListResults
					<React.Fragment key={index}>{action}</React.Fragment>
				))}
			</div>
		)}
	</div>
)

const listSelectionClass = 'list-selection'

/** Copy of ListSelection_v4, the bar the route view puts in its header when items are selected. */
export const ListSelectionBar: React.FC<{
	readonly count: number
	readonly ListActions?: React.ReactNode[]
	readonly SelectionActions?: React.ReactNode[]
}> = ({ count, ListActions = [], SelectionActions = [] }) => {
	const { t } = useTranslation()

	return (
		<div className={listSelectionClass}>
			<span>{t('general:selectedCount', { count, label: '' })}</span>
			{ListActions.length > 0 && (
				<React.Fragment>
					<span>&mdash;</span>
					<div className={`${listSelectionClass}__actions`}>{ListActions}</div>
				</React.Fragment>
			)}
			{SelectionActions.length > 0 && (
				<React.Fragment>
					<span>&mdash;</span>
					<div className={`${listSelectionClass}__actions`}>{SelectionActions}</div>
				</React.Fragment>
			)}
		</div>
	)
}

export const ListSelectionButton: React.FC<{
	readonly children: React.ReactNode
	readonly onClick: () => void
}> = ({ children, onClick }) => (
	<Button
		buttonStyle="none"
		className={`${listSelectionClass}__button`}
		el="button"
		onClick={onClick}
	>
		{children}
	</Button>
)

const dragOverlayClass = 'drag-overlay-selection'

/** Distance the card is held away from the cursor, matching Payload's own overlay. */
const cursorGap = 5

/**
 * `getEventCoordinates` from `@dnd-kit/utilities`, which reaches this package only through
 * `@dnd-kit/core` and would have to be declared a second peer dependency to import. Reading two
 * numbers off an event does not justify that.
 */
const eventCoordinates = (event: Event): null | { x: number; y: number } => {
	if (typeof TouchEvent !== 'undefined' && event instanceof TouchEvent) {
		const touch = event.touches[0] ?? event.changedTouches[0]
		return touch ? { x: touch.clientX, y: touch.clientY } : null
	}

	return event instanceof MouseEvent ? { x: event.clientX, y: event.clientY } : null
}

/**
 * Pins the card's top left corner just below and to the right of the cursor, whatever part of it
 * was grabbed. dnd-kit otherwise preserves the grab point, so a card taken by its bottom edge
 * trails from that edge and covers what is being dragged over.
 *
 * Payload applies the same modifier to its own folder overlay but does not export it.
 */
export const snapTopLeftToCursor: Modifier = ({ activatorEvent, draggingNodeRect, transform }) => {
	if (!draggingNodeRect || !activatorEvent) {
		return transform
	}

	const coordinates = eventCoordinates(activatorEvent)
	if (!coordinates) {
		return transform
	}

	return {
		...transform,
		x: transform.x + coordinates.x - draggingNodeRect.left + cursorGap,
		y: transform.y + coordinates.y - draggingNodeRect.top + cursorGap,
	}
}

/** Hoisted so the overlay is not handed a new array on every render. */
const dragOverlayModifiers = [snapTopLeftToCursor]

/**
 * The card that follows the cursor while dragging. `DragOverlaySelection` and the `FolderFileCard`
 * it renders are both internal, so this reproduces the folder variant of that card: an icon and a
 * title, which is all the original draws once its drop area and popup are left out.
 */
export const DragOverlaySelection: React.FC<{
	readonly selectedCount: number
	readonly title: string
}> = ({ selectedCount, title }) => (
	<DragOverlay
		dropAnimation={null}
		modifiers={dragOverlayModifiers}
		style={{ height: 'unset', maxWidth: '220px' }}
	>
		<div className={`${dragOverlayClass}__cards`}>
			{Array.from({ length: selectedCount > 1 ? 2 : 1 }).map((_, index) => (
				<div
					className={`${dragOverlayClass}__card`}
					// biome-ignore lint/suspicious/noArrayIndexKey: mirrors Payload's own overlay
					key={index}
					style={{ right: `${index * 3}px`, top: `-${index * 3}px` }}
				>
					<div className="folder-file-card folder-file-card--folder folder-file-card--selected">
						<div className="folder-file-card__titlebar-area">
							<div className="folder-file-card__icon-wrap">
								<FolderIcon className="colored-folder-icon" />
							</div>
							<div className="folder-file-card__titlebar-labels">
								<p className="folder-file-card__name" title={title}>
									<span>{title}</span>
								</p>
							</div>
						</div>
					</div>
				</div>
			))}
			{selectedCount > 1 ? (
				<span className={`${dragOverlayClass}__card-count`}>{selectedCount}</span>
			) : null}
		</div>
	</DragOverlay>
)

/**
 * Copy of the listener `DefaultCollectionFolderView` declares inline, which is why it is not
 * importable. Without it a drop never reaches `moveToFolder` and the provider's drag flag is
 * never cleared.
 */
export const DndEventListener: React.FC<{
	readonly onDragEnd: (event: DragEndEvent) => void
	readonly setIsDragging: (isDragging: boolean) => void
}> = ({ onDragEnd, setIsDragging }) => {
	useDndMonitor({
		onDragCancel: () => setIsDragging(false),
		onDragEnd: (event) => {
			setIsDragging(false)
			onDragEnd(event)
		},
		onDragStart: () => setIsDragging(true),
	})

	return null
}
