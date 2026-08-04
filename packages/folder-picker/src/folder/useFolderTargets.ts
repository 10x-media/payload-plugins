'use client'

import { getTranslation } from '@payloadcms/translations'
import { useConfig, useFolder, useTranslation } from '@payloadcms/ui'
import type { CollectionSlug } from 'payload'
import type { FolderOrDocument } from 'payload/shared'
import React from 'react'

type Args = {
	collectionSlug: CollectionSlug
	currentFolderName: string
	folderCollectionSlug: CollectionSlug
	onChanged: (nextFolderID: null | number | string) => Promise<void> | void
	parentFolderID?: number | string
}

/**
 * What the folder actions operate on, shared by the selection bar and the menu so the two can never
 * disagree.
 *
 * A single click selects a card and a double click opens it, so a selection is the target when
 * there is one and the folder in view is the target otherwise. Editing needs exactly one target,
 * which is why it disappears once several are selected.
 */
export const useFolderTargets = ({
	collectionSlug,
	currentFolderName,
	folderCollectionSlug,
	onChanged,
	parentFolderID,
}: Args) => {
	const { config, getEntityConfig } = useConfig()
	const { clearSelections, folderID, getSelectedItems, moveToFolder } = useFolder()
	const { i18n, t } = useTranslation()

	const selected: FolderOrDocument[] = getSelectedItems?.() ?? []
	const count = selected.length
	const folderLabel = getTranslation(
		getEntityConfig({ collectionSlug: folderCollectionSlug })?.labels?.singular ?? '',
		i18n
	)

	/** Editing needs one document; with none selected that is the folder in view. */
	const editTarget =
		count === 1
			? { id: selected[0].value.id, name: String(selected[0].value._folderOrDocumentTitle ?? '') }
			: count === 0 && folderID
				? { id: folderID, name: currentFolderName }
				: null

	const move = React.useCallback(
		async (destination: { id: null | number | string }) => {
			const itemsToMove = count > 0 ? selected : []
			if (itemsToMove.length > 0) {
				await moveToFolder({ itemsToMove, toFolderID: destination.id ?? undefined })
				clearSelections()
				await onChanged(folderID ?? null)
				return
			}

			// Nothing selected: the folder in view is being moved, so follow it.
			if (!folderID) return
			await fetch(`${config.routes.api}/${folderCollectionSlug}/${folderID}`, {
				body: JSON.stringify({ folder: destination.id ?? null }),
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				method: 'PATCH',
			})
			await onChanged(folderID)
		},
		[
			clearSelections,
			config.routes.api,
			count,
			folderCollectionSlug,
			folderID,
			moveToFolder,
			onChanged,
			selected,
		]
	)

	const remove = React.useCallback(async () => {
		const targets =
			count > 0
				? selected
				: folderID
					? [{ relationTo: folderCollectionSlug, value: { id: folderID } }]
					: []
		if (targets.length === 0) return

		for (const item of targets) {
			await fetch(`${config.routes.api}/${item.relationTo}/${item.value.id}`, {
				credentials: 'include',
				method: 'DELETE',
			})
		}

		clearSelections()
		// Deleting the folder in view leaves nowhere to stand, so fall back to its parent.
		await onChanged(count > 0 ? (folderID ?? null) : (parentFolderID ?? null))
	}, [
		clearSelections,
		config.routes.api,
		count,
		folderCollectionSlug,
		folderID,
		onChanged,
		parentFolderID,
		selected,
	])

	return {
		clearSelections,
		collectionSlug,
		count,
		editTarget,
		folderLabel,
		hasTarget: count > 0 || Boolean(folderID),
		move,
		remove,
		selected,
		t,
		viewFolderID: folderID ?? undefined,
		viewFolderName: currentFolderName,
	}
}
