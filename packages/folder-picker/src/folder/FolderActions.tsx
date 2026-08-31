'use client'

import {
	ConfirmationModal,
	MoveDocToFolderButton,
	Popup,
	PopupList,
	useDocumentDrawer,
	useModal,
} from '@payloadcms/ui'
import type { CollectionSlug } from 'payload'
import React from 'react'
import { Dots, ListSelectionBar, ListSelectionButton } from './native'
import { useFolderTargets } from './useFolderTargets'

export type FolderActionHandlers = {
	openDelete: () => void
	openEdit: () => void
	openMove: () => void
}

type SharedProps = {
	/** The menu owns the drawers; the bar unmounts with the selection, so it calls in through this. */
	readonly handlersRef: React.RefObject<FolderActionHandlers | null>
	readonly collectionSlug: CollectionSlug
	readonly currentFolderName: string
	readonly folderCollectionSlug: CollectionSlug
	readonly folderFieldName: string
	readonly onChanged: (nextFolderID: null | number | string) => Promise<void> | void
	readonly parentFolderID?: number | string
}

const deleteModalSlug = 'folder-browser-confirm-delete'
const moveModalSlug = 'folder-browser-move'

/**
 * Edit / move / delete, driven by useFolderTargets so the menu and the selection bar can never
 * disagree on what they act on. The edit drawer is keyed on its target because
 * `useDocumentDrawer` derives its slug from `id` on every render but builds the drawer once, and
 * would otherwise keep pointing at whatever was open when it was created.
 */
export const FolderActionsMenu: React.FC<SharedProps> = (props) => {
	const {
		clearSelections,
		count,
		editTarget,
		folderLabel,
		hasTarget,
		move,
		remove,
		selected,
		t,
		viewFolderID,
		viewFolderName,
	} = useFolderTargets(props)
	const { openModal } = useModal()
	const moveButtonRef = React.useRef<HTMLDivElement>(null)
	const openMove = React.useCallback(() => {
		moveButtonRef.current?.querySelector('button')?.click()
	}, [])

	// The picker only labels one document, so with several selected it names the first; the move is
	// applied to all of them in `move`.
	const pickerDoc =
		editTarget ??
		(selected[0]
			? { id: selected[0].value.id, name: String(selected[0].value._folderOrDocumentTitle ?? '') }
			: { id: viewFolderID ?? '', name: viewFolderName })

	const [EditDrawer, , { closeDrawer: closeEditDrawer, openDrawer: openEditDrawer }] =
		useDocumentDrawer({
			id: editTarget ? String(editTarget.id) : undefined,
			collectionSlug: props.folderCollectionSlug,
		})

	props.handlersRef.current = {
		openDelete: () => openModal(deleteModalSlug),
		openEdit: openEditDrawer,
		openMove,
	}

	if (!hasTarget) {
		return null
	}

	return (
		<React.Fragment>
			<Popup
				button={<Dots ariaLabel={t('general:moreOptions')} />}
				className="current-folder-actions"
				horizontalAlign="right"
				verticalAlign="bottom"
			>
				<PopupList.ButtonGroup>
					{count > 0 ? (
						<PopupList.Button onClick={() => clearSelections()}>
							{t('general:clearAll')}
						</PopupList.Button>
					) : null}
					{/* Editing needs exactly one target, so it drops out once several are selected. */}
					{editTarget ? (
						<PopupList.Button onClick={openEditDrawer}>
							{t('general:editLabel', { label: folderLabel })}
						</PopupList.Button>
					) : null}
					<PopupList.Button onClick={openMove}>{t('general:move')}</PopupList.Button>
					<PopupList.Button onClick={() => openModal(deleteModalSlug)}>
						{t('general:delete')}
					</PopupList.Button>
				</PopupList.ButtonGroup>
			</Popup>

			{/* MoveItemsToFolderDrawer, which owns the picker, is missing from the bundled client entry.
				Reaching it through the ./elements/* subpath does not work: Payload ships its client
				components twice, and the unbundled copy carries its own React contexts, so the drawer
				loads with no modal provider above it and reads an undefined modalState.

				MoveDocToFolderButton bundles the same drawer and does come from the bundle, but labels itself for a doc's edit
				view and cannot take children, so its trigger stays hidden and is clicked from the menu.
				It only knows one document, so it is used purely to pick a destination; the move is then
				applied to every target. The picker opens on the folder in view. */}
			<div hidden ref={moveButtonRef}>
				<MoveDocToFolderButton
					collectionSlug={props.collectionSlug}
					docData={{
						_folderOrDocumentTitle: pickerDoc.name,
						folderType: [props.collectionSlug],
						id: pickerDoc.id,
					}}
					docID={pickerDoc.id}
					docTitle={pickerDoc.name}
					folderCollectionSlug={props.folderCollectionSlug}
					folderFieldName={props.folderFieldName}
					fromFolderID={viewFolderID}
					fromFolderName={viewFolderName}
					modalSlug={moveModalSlug}
					onConfirm={move}
				/>
			</div>

			{editTarget ? (
				<EditDrawer
					key={String(editTarget.id)}
					onSave={async () => {
						closeEditDrawer()
						await props.onChanged(viewFolderID ?? null)
					}}
				/>
			) : null}

			<ConfirmationModal
				body={t('general:aboutToDeleteCount', { count: Math.max(count, 1), label: folderLabel })}
				confirmingLabel={t('general:deleting')}
				heading={t('general:confirmDeletion')}
				modalSlug={deleteModalSlug}
				onConfirm={remove}
			/>
		</React.Fragment>
	)
}

/**
 * The horizontal bar the route view shows while items are selected: same actions and the same
 * conditions as the menu. Hidden on small screens, where the menu is the usable form.
 */
export const FolderSelectionBar: React.FC<SharedProps> = (props) => {
	const { clearSelections, count, editTarget, folderLabel, t } = useFolderTargets(props)

	if (count === 0) {
		return null
	}

	return (
		<ListSelectionBar
			count={count}
			ListActions={[
				<ListSelectionButton key="clear-all" onClick={() => clearSelections()}>
					{t('general:clearAll')}
				</ListSelectionButton>,
			]}
			SelectionActions={[
				editTarget ? (
					<ListSelectionButton key="edit" onClick={() => props.handlersRef.current?.openEdit()}>
						{t('general:editLabel', { label: folderLabel })}
					</ListSelectionButton>
				) : null,
				<ListSelectionButton key="move" onClick={() => props.handlersRef.current?.openMove()}>
					{t('general:move')}
				</ListSelectionButton>,
				<ListSelectionButton key="delete" onClick={() => props.handlersRef.current?.openDelete()}>
					{t('general:delete')}
				</ListSelectionButton>,
			].filter(Boolean)}
		/>
	)
}
