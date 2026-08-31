'use client'

import { getTranslation } from '@payloadcms/translations'
import { toast, useConfig, useFolder, useTranslation } from '@payloadcms/ui'
import type { CollectionSlug } from 'payload'
import type { FolderOrDocument } from 'payload/shared'
import React from 'react'

/**
 * `fetch` rejects only on a network failure, so a 401, 403 or 500 arrives as an ordinary response.
 * Left unchecked the caller would clear the selection and reload, presenting a refusal as a
 * success: the same rows, no message, and the user believing the move or the delete happened.
 */
const reportFailure = async (response: Response): Promise<void> => {
	const body = (await response.json().catch(() => null)) as null | {
		errors?: { message?: string }[]
	}

	toast.error(body?.errors?.[0]?.message ?? `${response.status} ${response.statusText}`)
}

type Args = {
	collectionSlug: CollectionSlug
	currentFolderName: string
	folderCollectionSlug: CollectionSlug
	/** `config.folders.fieldName`, which a host is free to rename away from the default `folder`. */
	folderFieldName: string
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
	folderFieldName,
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

	/**
	 * Editing needs one folder; with none selected that is the folder in view. Read out rather than
	 * indexed twice, so noUncheckedIndexedAccess narrows once for the branch.
	 *
	 * A selected document is not a target. The drawer this feeds is keyed to the folder collection,
	 * so handing it a document's id sends the admin to `?notFound=<id>`, and Payload's own selection
	 * bar hides the action in exactly this case rather than editing the document.
	 */
	const [firstSelected] = selected
	const editTarget =
		count === 1 && firstSelected && firstSelected.relationTo === folderCollectionSlug
			? {
					id: firstSelected.value.id,
					name: String(firstSelected.value._folderOrDocumentTitle ?? ''),
				}
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

			// Nothing selected: the folder in view is being moved, so follow it. A folder's parent is
			// held in the same configured field its documents use, which the host may have renamed.
			if (!folderID) return
			const response = await fetch(`${config.routes.api}/${folderCollectionSlug}/${folderID}`, {
				body: JSON.stringify({ [folderFieldName]: destination.id ?? null }),
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				method: 'PATCH',
			})

			if (!response.ok) {
				await reportFailure(response)
				return
			}

			await onChanged(folderID)
		},
		[
			clearSelections,
			config.routes.api,
			count,
			folderCollectionSlug,
			folderFieldName,
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
			const response = await fetch(`${config.routes.api}/${item.relationTo}/${item.value.id}`, {
				credentials: 'include',
				method: 'DELETE',
			})

			// Stopping on the first refusal rather than carrying on: whatever denied one delete, a
			// permission or a relationship, will deny the rest, and the ones already gone still need
			// the view refreshed below.
			if (!response.ok) {
				await reportFailure(response)
				break
			}
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
