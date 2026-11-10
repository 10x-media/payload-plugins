'use client'

import {
	Button,
	useBulkUpload,
	useConfig,
	useListDrawerContext,
	useModal,
	useTranslation,
} from '@payloadcms/ui'
import type { CollectionSlug } from 'payload'
import React from 'react'

type BulkUploadButtonProps = {
	readonly collectionSlug: CollectionSlug
	/** The upload field sets this from `hasMany`, so it is the honest test for a multi-file flow. */
	readonly enableRowSelections?: boolean
	/** The folder the files land in; Payload's bulk upload fills the folder field from it. */
	readonly parentID?: null | number | string
}

/**
 * Opens the bulk upload modal the upload field already mounts. `BulkUploadProvider` wraps the
 * field and renders the modal itself, so only a trigger is missing. Created documents come back
 * through `setOnSuccess` and go to the list drawer's `onBulkSelect`, the path the field uses when
 * several rows are confirmed from the list.
 */
export const BulkUploadButton: React.FC<BulkUploadButtonProps> = ({
	collectionSlug,
	enableRowSelections,
	parentID,
}) => {
	const { getEntityConfig } = useConfig()
	const { t } = useTranslation()
	const { onBulkSelect } = useListDrawerContext()
	const { openModal } = useModal()
	const { modalSlug, setCollectionSlug, setOnSuccess, setParentID } = useBulkUpload()

	// onBulkSelect exists for every upload field, so it cannot gate this. `enableRowSelections`
	// comes straight from `hasMany`: only then can the field hold what a bulk upload produces.
	const canBulkUpload =
		Boolean(enableRowSelections) &&
		Boolean(onBulkSelect) &&
		Boolean(getEntityConfig({ collectionSlug })?.upload)

	const open = React.useCallback(() => {
		setCollectionSlug(collectionSlug)
		setParentID(parentID ?? undefined)
		setOnSuccess((uploadedForms) => {
			const selected = new Map<number | string, boolean>(
				uploadedForms
					.map((form) => form.doc?.id as number | string | undefined)
					.filter((id): id is number | string => id !== undefined)
					.map((id) => [id, true])
			)
			onBulkSelect?.(selected)
		})
		openModal(modalSlug)
	}, [
		collectionSlug,
		modalSlug,
		onBulkSelect,
		openModal,
		parentID,
		setCollectionSlug,
		setOnSuccess,
		setParentID,
	])

	if (!canBulkUpload) {
		return null
	}

	return (
		<Button buttonStyle="secondary" el="button" margin={false} onClick={open} size="medium">
			{t('upload:bulkUpload')}
		</Button>
	)
}
