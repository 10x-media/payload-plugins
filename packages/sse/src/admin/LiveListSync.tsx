'use client'

import { useListQuery } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'

import { usePayloadList } from '../client/usePayloadList'
import { emitListFlash } from './listFlash'

type LiveListSyncProps = {
	collection?: string
}

/**
 * One SSE subscription per collection list view. On mutation, refines the list
 * once and flashes cells via the module-level list-flash signal.
 */
export const LiveListSync = ({ collection: collectionProp }: LiveListSyncProps) => {
	const listQuery = useListQuery()
	const router = useRouter()
	const collection = collectionProp ?? ''
	const { generation, lastEvent } = usePayloadList({ collection })
	const prevGeneration = useRef(generation)

	useEffect(() => {
		if (!collection || generation === prevGeneration.current) {
			prevGeneration.current = generation
			return
		}
		prevGeneration.current = generation

		if (typeof listQuery.refineListData === 'function') {
			void listQuery.refineListData({ page: listQuery.query?.page ?? 1 })
		}

		router.refresh()
		emitListFlash({ collection, docId: lastEvent?.docId })
	}, [collection, generation, lastEvent, listQuery, router])

	return null
}
