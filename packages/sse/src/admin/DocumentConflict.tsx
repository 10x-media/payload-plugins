'use client'

import { useAuth, useDocumentInfo, useFormModified } from '@payloadcms/ui'

import { useDocumentConflict } from '../client/useDocumentConflict'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import './tokens.css'

/**
 * Advisory banner when this edit form is dirty and someone else saved or deleted
 * the document. Does not block save. Last write wins.
 */
export const DocumentConflict = () => {
	const { t } = useTranslation()
	const { id, collectionSlug } = useDocumentInfo()
	const { user } = useAuth()
	const modified = useFormModified()
	const docId = id == null ? '' : String(id)
	const collection = collectionSlug ?? ''
	const selfId = String((user as { id?: unknown } | null | undefined)?.id ?? '')

	const { conflict, dismiss } = useDocumentConflict({
		collection,
		id: docId,
		selfId,
		modified,
	})

	if (!collection || !docId || !user || !conflict) {
		return null
	}

	const message =
		conflict.operation === 'delete' ? t(keys.conflictDeleted) : t(keys.conflictUpdated)

	return (
		<div className="sse-document-conflict" role="status">
			<p>{message}</p>
			<div className="sse-document-conflict-actions">
				<button
					onClick={() => {
						window.location.reload()
					}}
					type="button"
				>
					{t(keys.conflictReload)}
				</button>
				<button onClick={dismiss} type="button">
					{t(keys.conflictKeepEditing)}
				</button>
			</div>
		</div>
	)
}
