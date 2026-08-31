'use client'

import { useCallback, useEffect, useState } from 'react'

import type { RealtimeEvent, SSEOperation } from '../broker/types'
import { usePayloadSubscription } from './usePayloadSubscription'

export type DocumentConflictOperation = Extract<SSEOperation, 'update' | 'delete'>

export type DocumentConflictState = {
	id: string
	operation: DocumentConflictOperation
	actorId?: string
}

export type UseDocumentConflictOptions = {
	collection: string
	id: string
	selfId: string
	modified: boolean
	token?: string
	url?: string
}

export type UseDocumentConflictResult = {
	conflict: DocumentConflictState | null
	dismiss: () => void
}

const writeOperation = (event: RealtimeEvent): DocumentConflictOperation | null => {
	if (event.operation === 'update' || event.event === 'update') {
		return 'update'
	}
	if (event.operation === 'delete' || event.event === 'delete') {
		return 'delete'
	}
	return null
}

/**
 * Tracks the latest foreign document write on `${collection}:${id}`.
 * Surfaces a conflict only while `modified` is true. Dismiss hides that event
 * until a newer foreign write. Own `actorId` clears the remembered write.
 */
export const useDocumentConflict = (
	opts: UseDocumentConflictOptions
): UseDocumentConflictResult => {
	const { collection, id, selfId, modified, token, url } = opts
	const [latestForeign, setLatestForeign] = useState<DocumentConflictState | null>(null)
	const [dismissedId, setDismissedId] = useState<string | null>(null)

	useEffect(() => {
		void collection
		void id
		setLatestForeign(null)
		setDismissedId(null)
	}, [collection, id])

	usePayloadSubscription({
		topics: collection && id ? [`${collection}:${id}`] : [],
		token,
		url,
		onEvent: (event) => {
			if (event.event === 'ready' || event.event === 'create' || event.operation === 'create') {
				return
			}
			const operation = writeOperation(event)
			if (!operation) {
				return
			}
			if (event.actorId !== undefined && event.actorId === selfId) {
				setLatestForeign(null)
				return
			}
			setLatestForeign({
				id: event.id,
				operation,
				actorId: event.actorId,
			})
		},
	})

	const dismiss = useCallback(() => {
		setDismissedId(latestForeign?.id ?? null)
	}, [latestForeign])

	const conflict =
		modified && latestForeign && latestForeign.id !== dismissedId ? latestForeign : null

	return { conflict, dismiss }
}
