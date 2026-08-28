'use client'

import { useState } from 'react'

import type { RealtimeEvent } from '../broker/types'
import { type SubscriptionStatus, usePayloadSubscription } from './usePayloadSubscription'

export type UsePayloadListOptions = {
	collection: string
	token?: string
	url?: string
}

const MUTATIONS = new Set(['create', 'update', 'delete'])

export const usePayloadList = (
	options: UsePayloadListOptions
): {
	status: SubscriptionStatus
	generation: number
	lastEvent: RealtimeEvent | null
} => {
	const { collection, token, url } = options
	const [generation, setGeneration] = useState(0)

	const { status, lastEvent } = usePayloadSubscription({
		topics: [collection],
		token,
		url,
		onEvent: (event) => {
			if (MUTATIONS.has(String(event.event))) {
				setGeneration((n) => n + 1)
			}
		},
	})

	return { status, generation, lastEvent }
}
