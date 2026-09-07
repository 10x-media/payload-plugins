'use client'

import { toast, useDocumentEvents, useServerFunctions } from '@payloadcms/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type React from 'react'
import { useEffect, useRef } from 'react'

import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { documentQuery, overlayKeys } from '../queries'
import { DocumentSkeleton } from '../skeletons'

/**
 * Payload's edit view, hosted in the pane, for a collection document, the create form
 * (`id === 'new'`) or a global.
 *
 * The render is always refetched on mount, so a form never opens on stale data, while a cached
 * render shows meanwhile. Every save reported for this collection invalidates its list renders,
 * so the list behind the back button is current.
 *
 * The view runs with `disableActions`; `../documentActions.tsx` puts delete, duplicate, restore
 * and "create new" back. A save is still noticed through `useDocumentEvents`, which is the one
 * document event Payload reports.
 */
export const DocumentPane: React.FC<{
	entity: 'collection' | 'global'
	id?: string
	onBack?: () => void
	onCreated?: (id: string) => void
	panelSlug: string
	slug: string
}> = ({ entity, id, onBack, onCreated, panelSlug, slug }) => {
	const { renderDocument } = useServerFunctions()
	const { mostRecentUpdate } = useDocumentEvents()
	const queryClient = useQueryClient()
	const { t } = useTranslation()

	// The provider keeps the last document event around, so identity against what this pane saw
	// at mount is the only reliable "this happened here" test. Timestamps are not.
	const initialEvent = useRef(mostRecentUpdate)

	// The panel rebuilds this callback on every state change, and a failed render is not a reason
	// to re-run the effect below. The latest one is what a failure should call.
	const backRef = useRef(onBack)
	backRef.current = onBack

	const isCreate = entity === 'collection' && id === 'new'
	const docID = entity === 'collection' && id && id !== 'new' ? id : undefined

	const { data, error, isPending } = useQuery(
		documentQuery(renderDocument, { docID, entity, isCreate, panelSlug, slug })
	)

	// A failed render toasts once; a collection document falls back to its list, a global has
	// nowhere to go and says so in place.
	useEffect(() => {
		if (isPending || (!error && data !== null)) {
			return
		}
		toast.error(error instanceof Error ? error.message : t(keys.loadFailed))
		backRef.current?.()
	}, [data, error, isPending, t])

	useEffect(() => {
		// The event this pane was born with is somebody else's; only a new one counts.
		if (mostRecentUpdate === initialEvent.current || !mostRecentUpdate) {
			return
		}
		if (mostRecentUpdate.entitySlug !== slug) {
			return
		}
		// Whatever was saved, the list renders for this collection are out of date.
		void queryClient.invalidateQueries({ queryKey: overlayKeys.lists(slug) })
		if (!isCreate || !onCreated || mostRecentUpdate.operation !== 'create') {
			return
		}
		const createdId = mostRecentUpdate.doc?.id ?? mostRecentUpdate.id
		if (createdId) {
			onCreated(String(createdId))
		}
	}, [isCreate, mostRecentUpdate, onCreated, queryClient, slug])

	if (isPending) {
		return <DocumentSkeleton />
	}
	if (error || data === null) {
		return <p className="settings-overlay__empty">{t(keys.loadFailed)}</p>
	}
	return <>{data}</>
}
