'use client'

import { toast, useServerFunctions } from '@payloadcms/ui'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'next/navigation'
import type React from 'react'
import { useEffect, useMemo } from 'react'

import { QUERY_PARAM, SEARCH_PARAM } from '../../plugin/constants'
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
			if (key !== SEARCH_PARAM && key !== QUERY_PARAM) {
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
	return <>{data}</>
}
