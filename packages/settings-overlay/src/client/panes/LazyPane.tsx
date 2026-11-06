'use client'

import { toast, useSearchParams, useServerFunctions } from '@payloadcms/ui'
import { useQuery } from '@tanstack/react-query'
import type React from 'react'
import { Suspense, useEffect, useMemo } from 'react'

import { SEARCH_PARAM } from '../../plugin/constants'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { useSettingsOverlay } from '../context'
import { lazyItemQuery } from '../queries'
import { ItemSkeleton } from '../skeletons'
import { transportFor } from '../transport'

/**
 * A `view` item, or a `component` item that asked to be lazy: fetched on open rather than
 * rendered with the page.
 */
export const LazyPane: React.FC<{ itemSlug: string; overlayId: string }> = ({
	itemSlug,
	overlayId,
}) => {
	const { serverFunction } = useServerFunctions()
	const { lazyTransport } = useSettingsOverlay()
	const urlParams = useSearchParams()
	const { t } = useTranslation()

	// Everything in the URL that is not the panel's own, as the view would read it on a page.
	const searchParams = useMemo(() => {
		const out: Record<string, string> = {}
		urlParams.forEach((value, key) => {
			if (key !== SEARCH_PARAM) {
				out[key] = value
			}
		})
		return out
	}, [urlParams])

	const { data, error, isPending } = useQuery(
		lazyItemQuery(transportFor(lazyTransport), serverFunction, {
			itemSlug,
			overlayId,
			searchParams,
		})
	)

	useEffect(() => {
		if (error) {
			toast.error(error instanceof Error ? error.message : t(keys.loadFailed))
		}
	}, [error, t])

	if (isPending) {
		return <ItemSkeleton />
	}
	if (error || data === null) {
		return <p className="settings-overlay__empty">{t(keys.loadFailed)}</p>
	}
	// A server-rendered tree can suspend as it mounts: on TanStack Start its client references and
	// lazy chunks resolve after the response does. Without a boundary of its own the nearest one is
	// the app's, which hides the whole admin for that moment, so the pane keeps its skeleton up.
	return <Suspense fallback={<ItemSkeleton />}>{data}</Suspense>
}
