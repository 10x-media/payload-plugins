'use client'

import {
	Button,
	Pill,
	useBulkUpload,
	useConfig,
	useFolder,
	useListDrawerContext,
	useModal,
	useTranslation,
} from '@payloadcms/ui'
import type { CollectionSlug } from 'payload'
import React from 'react'

/**
 * Set to false to drop bulk upload from the drawer. Everything else keeps working; the button and
 * its wiring are the only things gated on it.
 */
export const BULK_UPLOAD_IN_DRAWER = true

type BulkUploadButtonProps = {
	readonly collectionSlug: CollectionSlug
	/** The upload field sets this from `hasMany`, so it is the honest test for a multi-file flow. */
	readonly enableRowSelections?: boolean
	readonly folderID?: null | number | string
}

/**
 * Opens the bulk upload drawer the upload field already mounts. `BulkUploadProvider` wraps the
 * field and renders `<BulkUploadDrawer />` itself, so only a trigger is missing. Created documents
 * come back through `setOnSuccess` and are handed to the list drawer's `onBulkSelect`, the same
 * path the field uses when several rows are picked from the list.
 */
export const BulkUploadButton: React.FC<BulkUploadButtonProps> = ({
	collectionSlug,
	enableRowSelections,
	folderID,
}) => {
	const { getEntityConfig } = useConfig()
	const { t } = useTranslation()
	const { onBulkSelect } = useListDrawerContext()
	const { openModal } = useModal()
	const { drawerSlug, setCollectionSlug, setFolderID, setOnSuccess } = useBulkUpload()

	// onBulkSelect exists for every upload field, so it cannot gate this. The field passes
	// enableRowSelections straight from `hasMany`, which is the real signal: only then can it hold
	// the several documents a bulk upload produces.
	const canBulkUpload =
		BULK_UPLOAD_IN_DRAWER &&
		Boolean(enableRowSelections) &&
		Boolean(onBulkSelect) &&
		Boolean(getEntityConfig({ collectionSlug })?.upload)

	const open = React.useCallback(() => {
		setCollectionSlug(collectionSlug)
		setFolderID(folderID ?? undefined)
		setOnSuccess((uploadedForms) => {
			const selected = new Map<number | string, boolean>(
				uploadedForms
					.map((form) => form.doc?.id as number | string | undefined)
					.filter((id): id is number | string => id !== undefined)
					.map((id) => [id, true])
			)
			void onBulkSelect?.(selected)
		})
		openModal(drawerSlug)
	}, [
		collectionSlug,
		drawerSlug,
		folderID,
		onBulkSelect,
		openModal,
		setCollectionSlug,
		setFolderID,
		setOnSuccess,
	])

	if (!canBulkUpload) {
		return null
	}

	return (
		<Button buttonStyle="pill" el="button" onClick={open} size="small">
			{t('upload:bulkUpload')}
		</Button>
	)
}

/**
 * Hands the selection to the field, in the search bar row and as the same `Pill` Payload puts its
 * own `SelectMany` in, so both tabs of the drawer confirm in the same place. Dark rather than white
 * because the folder view has no row checkboxes to hint that selecting is a thing, which is what
 * made picking a file look like it needed a double click.
 *
 * Payload's own version covers `hasMany` alone. A single-value field has no bulk path, so it gets
 * the first selected document through the same `onSelect` a double click uses. Folders are skipped
 * either way: an upload field can only hold documents.
 */
export const SelectFolderItems: React.FC<{
	readonly collectionSlug: CollectionSlug
	readonly enableRowSelections?: boolean
}> = ({ collectionSlug, enableRowSelections }) => {
	const { getSelectedItems } = useFolder()
	const { onBulkSelect, onSelect } = useListDrawerContext()
	const { t } = useTranslation()

	const documents = (getSelectedItems?.() ?? []).filter(
		(item) => item.relationTo === collectionSlug
	)
	const [first] = documents

	if (!first) {
		return null
	}

	const confirm = () => {
		if (enableRowSelections && onBulkSelect) {
			void onBulkSelect(
				new Map<number | string, boolean>(documents.map((item) => [item.value.id, true]))
			)
			return
		}

		onSelect?.({ collectionSlug, doc: first.value, docID: String(first.value.id) })
	}

	return (
		<Pill onClick={confirm} pillStyle="dark" size="small">
			{documents.length > 1 ? `${t('general:select')} ${documents.length}` : t('general:select')}
		</Pill>
	)
}
