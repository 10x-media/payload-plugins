'use client'

import {
	Button,
	ChevronIcon,
	GridViewIcon,
	ListViewIcon,
	SearchFilter,
	SearchIcon,
	ShimmerEffect,
	SwapIcon,
	usePreferences,
	useTranslation,
} from '@payloadcms/ui'
import type { FolderOrDocument } from 'payload/shared'
import { useCallback, useEffect, useState } from 'react'

import { CreateNewDocButton } from '../../elements/CreateNewDocButton/index'
import { PickerBreadcrumbs } from '../../elements/PickerBreadcrumbs/index'
import { PickerFileTable } from '../../elements/PickerFileTable/index'
import { PickerItemCardGrid } from '../../elements/PickerItemCardGrid/index'
import { useFolderPicker } from '../../providers/FolderPickerContext/index'
import './DrawerContent.scss'

const baseClass = 'folder-picker-content'
const toggleBaseClass = 'folder-view-toggle-button'
const POLY_VIEW_PREF_KEY = 'folder-picker'

type DisplayAs = 'grid' | 'list'

type Props = {
	readonly collectionSlugs: string[]
	readonly folderCollectionSlug: string
	readonly hasMany?: boolean
	readonly onClose: () => void
	readonly onConfirm: (selectedItems: FolderOrDocument[]) => void
	readonly onSwitchToListView?: () => void
}

export function FolderPickerDrawerContent({
	collectionSlugs,
	folderCollectionSlug,
	hasMany,
	onClose,
	onConfirm,
	onSwitchToListView,
}: Props) {
	const { t } = useTranslation()
	const { getPreference, setPreference } = usePreferences()
	const {
		breadcrumbs,
		documents,
		isLoading,
		navigateToFolder,
		refetch,
		selectDocument,
		selectedItemKeys,
		setLocalSearch,
		subfolders,
		toggleSelectDocument,
	} = useFolderPicker()

	const handleGoUp = useCallback(() => {
		if (breadcrumbs.length === 0) return
		const parentId = breadcrumbs.length >= 2 ? breadcrumbs[breadcrumbs.length - 2]!.id! : undefined
		void navigateToFolder(parentId)
	}, [breadcrumbs, navigateToFolder])

	const handleCreated = useCallback(
		(item: FolderOrDocument) => {
			if (hasMany) {
				const allItems = [...subfolders, ...documents]
				const currentSelected = allItems.filter((i) => selectedItemKeys.has(i.itemKey))
				onConfirm([...currentSelected, item])
			} else {
				onConfirm([item])
			}
		},
		[hasMany, onConfirm, subfolders, documents, selectedItemKeys]
	)

	const [activeView, setActiveView] = useState<DisplayAs>('list')

	const viewPrefKey =
		collectionSlugs.length === 1 ? `${collectionSlugs[0]}-collection-folder` : POLY_VIEW_PREF_KEY

	// biome-ignore lint/correctness/useExhaustiveDependencies: No need to re-run this effect, viewPerfKey will never change once set
	useEffect(() => {
		void refetch()
		void getPreference<{ viewPreference?: DisplayAs }>(viewPrefKey).then((pref) => {
			if (pref?.viewPreference) setActiveView(pref.viewPreference)
		})
	}, [])

	const handleSetActiveView = useCallback(
		(view: DisplayAs) => {
			void setPreference(viewPrefKey, { viewPreference: view })
			setActiveView(view)
		},
		[setPreference, viewPrefKey]
	)

	const handleFolderClick = useCallback(
		(item: FolderOrDocument) => {
			void navigateToFolder(item.value.id as string | number)
		},
		[navigateToFolder]
	)

	const handleFileClick = useCallback(
		(item: FolderOrDocument) => {
			if (hasMany) {
				toggleSelectDocument(item)
			} else {
				selectDocument(item)
			}
		},
		[hasMany, toggleSelectDocument, selectDocument]
	)

	const handleConfirm = useCallback(() => {
		const allItems = [...subfolders, ...documents]
		const selected = allItems.filter((item) => selectedItemKeys.has(item.itemKey))
		onConfirm(selected)
	}, [onConfirm, subfolders, documents, selectedItemKeys])

	const selectionCount = selectedItemKeys.size
	const confirmDisabled = selectionCount === 0

	return (
		<div className={baseClass}>
			<div className={`${baseClass}__header`}>
				<PickerBreadcrumbs />
				<Button
					buttonStyle="icon-label"
					className={`${baseClass}__close`}
					icon="x"
					onClick={onClose}
				/>
			</div>

			<div className="search-bar">
				<SearchIcon />
				<SearchFilter handleChange={setLocalSearch} label={t('general:searchBy', { label: '' })} />
				<div className="search-bar__actions">
					<CreateNewDocButton
						collectionSlugs={collectionSlugs.filter((s) => s !== folderCollectionSlug)}
						onCreated={handleCreated}
					/>
					<Button
						buttonStyle="pill"
						className={[toggleBaseClass, activeView === 'grid' && `${toggleBaseClass}--active`]
							.filter(Boolean)
							.join(' ')}
						icon={<GridViewIcon />}
						margin={false}
						onClick={() => handleSetActiveView('grid')}
					/>
					<Button
						buttonStyle="pill"
						className={[toggleBaseClass, activeView === 'list' && `${toggleBaseClass}--active`]
							.filter(Boolean)
							.join(' ')}
						icon={<ListViewIcon />}
						margin={false}
						onClick={() => handleSetActiveView('list')}
					/>
				</div>
			</div>

			<div className={`${baseClass}__body`}>
				{isLoading ? (
					<div className={`${baseClass}__loading`}>
						{/* 
						This adds annoying flickering on folder navigation (if it's fast), so i'm not sure we should use it
						<ShimmerEffect height="40px" />
						<ShimmerEffect height="40px" />
						<ShimmerEffect height="40px" /> 
						*/}
					</div>
				) : documents.length === 0 && subfolders.length === 0 ? (
					<div className={`${baseClass}__empty`}>
						<span className={`${baseClass}__empty-text`}>
							{t('general:noResults', { label: 'Items' })}
						</span>
						{breadcrumbs.length > 0 && (
							<Button buttonStyle="secondary" onClick={handleGoUp}>
								<ChevronIcon direction="left" />
								{t('general:goBack')}
							</Button>
						)}
					</div>
				) : activeView === 'grid' ? (
					<PickerItemCardGrid
						folderCollectionSlug={folderCollectionSlug}
						onFileClick={handleFileClick}
						onFolderClick={handleFolderClick}
					/>
				) : (
					<PickerFileTable
						folderCollectionSlug={folderCollectionSlug}
						hasMany={hasMany}
						onFileClick={handleFileClick}
						onFolderClick={handleFolderClick}
					/>
				)}
			</div>

			<div className={`${baseClass}__footer`}>
				<div className={`${baseClass}__footer-left`}>
					{onSwitchToListView && (
						<Button
							buttonStyle="secondary"
							className={`${baseClass}__browse-all`}
							onClick={onSwitchToListView}
							size="medium"
							margin={false}
							icon={<SwapIcon />}
							iconPosition="left"
						>
							Browse all files
						</Button>
					)}
					<span className={`${baseClass}__selection-count`}>
						{selectionCount > 0 && hasMany ? `${selectionCount} selected` : ''}
					</span>
				</div>
				<div className={`${baseClass}__footer-actions`}>
					<Button buttonStyle="secondary" onClick={onClose}>
						{t('general:cancel')}
					</Button>
					<Button buttonStyle="primary" disabled={confirmDisabled} onClick={handleConfirm}>
						{t('general:confirm')}
					</Button>
				</div>
			</div>
		</div>
	)
}
