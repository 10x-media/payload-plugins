'use client'

import { Drawer, DrawerToggler, useConfig, useEditDepth, useModal } from '@payloadcms/ui'
import type { FilterOptionsResult } from 'payload'
import type { FolderOrDocument } from 'payload/shared'
import type React from 'react'
import { useCallback, useId, useMemo } from 'react'

import { FolderPickerProvider } from '../../providers/FolderPickerContext/index'
import { FolderPickerDrawerContent } from './DrawerContent'

export type FolderPickerDrawerProps = {
	readonly allowCreate?: boolean
	readonly closeDrawer: () => void
	readonly collectionSlugs: string[]
	readonly drawerSlug: string
	readonly excludeIds?: Set<string | number>
	readonly filterOptions?: FilterOptionsResult
	readonly hasMany?: boolean
	readonly onBulkSelect?: (docs: FolderOrDocument[]) => void
	readonly onSelect?: (args: { collectionSlug: string; doc: { id: string | number } }) => void
	readonly onSwitchToListView?: () => void
}

const baseClass = 'folder-picker-drawer'

export const formatFolderPickerDrawerSlug = ({ depth, uuid }: { depth: number; uuid: string }) =>
	`folder-picker-drawer_${depth}_${uuid}`

function FolderPickerDrawer(props: FolderPickerDrawerProps) {
	const {
		closeDrawer,
		collectionSlugs,
		drawerSlug,
		excludeIds,
		hasMany,
		onBulkSelect,
		onSelect,
		onSwitchToListView,
	} = props
	const { config } = useConfig()
	const folderCollectionSlug =
		typeof config.folders === 'object'
			? (config.folders.slug ?? 'payload-folders')
			: 'payload-folders'

	// Unified confirm — handles both single and multi selection
	const handleConfirm = useCallback(
		(selectedItems: FolderOrDocument[]) => {
			if (hasMany) {
				onBulkSelect?.(selectedItems)
			} else {
				const first = selectedItems[0]
				if (first) {
					onSelect?.({
						collectionSlug: first.relationTo,
						doc: { id: first.value.id as string | number },
					})
				}
			}
			closeDrawer()
		},
		[hasMany, onSelect, onBulkSelect, closeDrawer]
	)

	return (
		<Drawer className={baseClass} gutter={false} Header={null} slug={drawerSlug}>
			<FolderPickerProvider collectionSlugs={collectionSlugs} excludeIds={excludeIds}>
				<FolderPickerDrawerContent
					collectionSlugs={collectionSlugs}
					folderCollectionSlug={folderCollectionSlug}
					hasMany={hasMany}
					onClose={closeDrawer}
					onConfirm={handleConfirm}
					onSwitchToListView={onSwitchToListView}
				/>
			</FolderPickerProvider>
		</Drawer>
	)
}

type UseFolderPickerDrawerArgs = {
	collectionSlugs: string[]
	excludeIds?: Set<string | number>
	filterOptions?: FilterOptionsResult
	hasMany?: boolean
}

type FolderPickerDrawerState = {
	closeDrawer: () => void
	drawerSlug: string
	isDrawerOpen: boolean
	openDrawer: () => void
}

export function useFolderPickerDrawer({
	collectionSlugs,
	excludeIds,
	filterOptions,
	hasMany,
}: UseFolderPickerDrawerArgs): [
	React.FC<
		Pick<
			FolderPickerDrawerProps,
			'onSelect' | 'onBulkSelect' | 'allowCreate' | 'onSwitchToListView'
		>
	>,
	React.FC<{ children?: React.ReactNode; className?: string; disabled?: boolean }>,
	FolderPickerDrawerState,
] {
	const drawerDepth = useEditDepth()
	const uuid = useId()
	const { closeModal, modalState, openModal } = useModal()

	const drawerSlug = formatFolderPickerDrawerSlug({ depth: drawerDepth, uuid })
	const isDrawerOpen = Boolean(modalState[drawerSlug]?.isOpen)

	const closeDrawer = useCallback(() => closeModal(drawerSlug), [closeModal, drawerSlug])
	const openDrawer = useCallback(() => openModal(drawerSlug), [openModal, drawerSlug])

	const MemoizedDrawer = useMemo<
		React.FC<
			Pick<
				FolderPickerDrawerProps,
				'onSelect' | 'onBulkSelect' | 'allowCreate' | 'onSwitchToListView'
			>
		>
	>(
		() =>
			function PickerDrawerMemo({ allowCreate, onBulkSelect, onSelect, onSwitchToListView }) {
				return (
					<FolderPickerDrawer
						allowCreate={allowCreate}
						closeDrawer={closeDrawer}
						collectionSlugs={collectionSlugs}
						drawerSlug={drawerSlug}
						excludeIds={excludeIds}
						filterOptions={filterOptions}
						hasMany={hasMany}
						onBulkSelect={onBulkSelect}
						onSelect={onSelect}
						onSwitchToListView={onSwitchToListView}
					/>
				)
			},
		[drawerSlug, collectionSlugs, excludeIds, filterOptions, hasMany, closeDrawer]
	)

	const MemoizedToggler = useMemo<
		React.FC<{ children?: React.ReactNode; className?: string; disabled?: boolean }>
	>(
		() =>
			function PickerTogglerMemo({ children, className, disabled }) {
				return (
					<DrawerToggler className={className} disabled={disabled} slug={drawerSlug}>
						{children}
					</DrawerToggler>
				)
			},
		[drawerSlug]
	)

	const state = useMemo<FolderPickerDrawerState>(
		() => ({ closeDrawer, drawerSlug, isDrawerOpen, openDrawer }),
		[closeDrawer, drawerSlug, isDrawerOpen, openDrawer]
	)

	return [MemoizedDrawer, MemoizedToggler, state]
}
