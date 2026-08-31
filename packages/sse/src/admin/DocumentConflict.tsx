'use client'

import { useAuth, useDocumentInfo, useFormModified } from '@payloadcms/ui'
import { useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { useDocumentConflict } from '../client/useDocumentConflict'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import './tokens.css'

const CONTROLS_SELECTOR = '.doc-controls'
const HOST_CLASS = 'sse-document-conflict-host'

/**
 * Advisory banner when this edit form is dirty and someone else saved or deleted
 * the document. Does not block save. Last write wins.
 *
 * Mounted via `beforeDocumentControls` so hooks run on the edit view. The DOM
 * is portaled after `.doc-controls` because that slot is Payload's fixed-height
 * nowrap save toolbar, not a page banner.
 */
export const DocumentConflict = () => {
	const { t } = useTranslation()
	const { id, collectionSlug } = useDocumentInfo()
	const { user } = useAuth()
	const modified = useFormModified()
	const docId = id == null ? '' : String(id)
	const collection = collectionSlug ?? ''
	const selfId = String((user as { id?: unknown } | null | undefined)?.id ?? '')
	const [host, setHost] = useState<HTMLElement | null>(null)

	const { conflict, dismiss } = useDocumentConflict({
		collection,
		id: docId,
		selfId,
		modified,
	})

	useLayoutEffect(() => {
		const controls = document.querySelector(CONTROLS_SELECTOR)
		if (!controls) {
			return
		}
		const slot = document.createElement('div')
		slot.className = HOST_CLASS
		controls.insertAdjacentElement('afterend', slot)
		setHost(slot)
		return () => {
			slot.remove()
			setHost(null)
		}
	}, [])

	if (!collection || !docId || !user || !conflict || !host) {
		return null
	}

	const message =
		conflict.operation === 'delete' ? t(keys.conflictDeleted) : t(keys.conflictUpdated)

	return createPortal(
		<div className="sse-document-conflict" role="status">
			<p>{message}</p>
			<div className="sse-document-conflict-actions">
				<button onClick={dismiss} type="button">
					{t(keys.conflictKeepEditing)}
				</button>
				<button
					onClick={() => {
						window.location.reload()
					}}
					type="button"
				>
					{t(keys.conflictReload)}
				</button>
			</div>
		</div>,
		host
	)
}
