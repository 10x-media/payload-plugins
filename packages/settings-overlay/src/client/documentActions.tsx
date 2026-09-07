'use client'

import { Button, ConfirmationModal, toast, useAuth, useConfig, useModal } from '@payloadcms/ui'
import { useQueryClient } from '@tanstack/react-query'
import { formatAdminURL } from 'payload/shared'
import type React from 'react'
import { useCallback } from 'react'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { overlayKeys } from './queries'

/**
 * WORKAROUND. Delete for the document open in the pane, as a header button with its own REST
 * call, because the edit view cannot report the deletion back.
 *
 * What is being worked around: the edit view reads its drawer callbacks (`onDelete`,
 * `onDuplicate`, `onSave`, `clearDoc`) from `DocumentDrawerCallbacksContext` through
 * `useDocumentDrawerContext`. `@payloadcms/ui` exports the hook but not the provider, and the
 * provider's module is unreachable through the package's export map (`./elements/*` resolves to
 * `dist/elements/*\/index.js`, which does not re-export it). Supplying our own context object is
 * not an option either: the edit view reads that specific context, so a `createContext()` of the
 * same shape is simply a different object it will never look at.
 *
 * Consequences carried by the pane: `disableActions` hides the dots menu (in page mode it has
 * nobody to report to), deletion lives here instead, and a create is detected in `DocumentPane`
 * through `useDocumentEvents` rather than through `onSave`.
 *
 * What replaces this: `DocumentDrawerContextProvider` becoming public. The canary in
 * `tests/int/payloadCanaries.int.spec.ts` fails when it does, and then this file and the
 * `disableActions` flag in `queries.ts` both go.
 */
export const DeleteDocumentButton: React.FC<{
	collectionSlug: string
	docID: string
	onDeleted: () => void
	panelSlug: string
}> = ({ collectionSlug, docID, onDeleted, panelSlug }) => {
	const { permissions } = useAuth()
	const { config } = useConfig()
	const { openModal } = useModal()
	const queryClient = useQueryClient()
	const { i18n, t } = useTranslation()

	const deleteSlug = `${panelSlug}__delete`
	const canDelete = permissions?.collections?.[collectionSlug]?.delete === true

	const handleDelete = useCallback(async () => {
		try {
			const response = await fetch(
				formatAdminURL({ apiRoute: config.routes.api, path: `/${collectionSlug}/${docID}` }),
				{
					credentials: 'include',
					headers: { 'Accept-Language': i18n.language },
					method: 'DELETE',
				}
			)
			if (response.status < 400) {
				toast.success(t(keys.deleted))
				queryClient.removeQueries({
					queryKey: overlayKeys.document('collection', collectionSlug, docID),
				})
				void queryClient.invalidateQueries({ queryKey: overlayKeys.lists(collectionSlug) })
				onDeleted()
				return
			}
			const body = (await response.json().catch(() => null)) as {
				errors?: { message?: string }[]
			} | null
			toast.error(body?.errors?.[0]?.message ?? t(keys.loadFailed))
		} catch (error) {
			toast.error(error instanceof Error ? error.message : t(keys.loadFailed))
		}
	}, [collectionSlug, config.routes.api, docID, i18n.language, onDeleted, queryClient, t])

	if (!canDelete) {
		return null
	}

	return (
		<>
			<Button
				buttonStyle="secondary"
				className="settings-overlay__delete"
				margin={false}
				onClick={() => {
					openModal(deleteSlug)
				}}
				size="small"
			>
				{t(keys.delete)}
			</Button>
			<ConfirmationModal
				body={t(keys.deleteBody)}
				confirmLabel={t(keys.deleteConfirm)}
				heading={t(keys.deleteHeading)}
				modalSlug={deleteSlug}
				onConfirm={handleDelete}
			/>
		</>
	)
}
