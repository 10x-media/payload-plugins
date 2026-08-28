'use client'

import { useEffect, useState } from 'react'

import type { RealtimeEvent } from '../broker/types'
import { type SubscriptionStatus, usePayloadSubscription } from './usePayloadSubscription'

export type UsePayloadDocumentOptions = {
	collection: string
	id: string
	token?: string
	url?: string
}

export const usePayloadDocument = <T = unknown>(
	options: UsePayloadDocumentOptions
): {
	status: SubscriptionStatus
	doc: T | null
	revision: number
	lastEvent: RealtimeEvent | null
} => {
	const { collection, id, token, url } = options
	const [doc, setDoc] = useState<T | null>(null)
	const [revision, setRevision] = useState(0)

	useEffect(() => {
		void collection
		void id
		setDoc(null)
		setRevision(0)
	}, [collection, id])

	const { status, lastEvent } = usePayloadSubscription({
		topics: [`${collection}:${id}`],
		token,
		url,
		onEvent: (event) => {
			const data = event.data as { doc?: T } | undefined
			if (data && typeof data === 'object' && 'doc' in data && data.doc !== undefined) {
				setDoc(data.doc)
			} else if (event.event !== 'ready') {
				setRevision((n) => n + 1)
			}
		},
	})

	return { status, doc, revision, lastEvent }
}
