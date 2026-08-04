'use client'

import {
	Button,
	ChevronIcon,
	GridViewIcon,
	ListViewIcon,
	Pill,
	Popup,
	PopupList,
	SearchIcon,
	useDebounce,
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
	readonly className?: string
	readonly title: string
	readonly TitleActions?: React.ReactNode[]
}> = ({ Actions = [], className, title, TitleActions = [] }) => (
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
	</header>
)

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
