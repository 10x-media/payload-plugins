'use client'

import { useConfig, useDocumentInfo, useRowLabel } from '@payloadcms/ui'
import { useEffect, useState } from 'react'
import type { TranslationKey } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { buildEndpointOptionsUrl, parseEndpointOptions } from './endpointOptions'

type RowData = { source?: unknown }

/** Endpoint url -> `{ sourceId: name }`, shared across every consent block label and re-render. */
const nameCache = new Map<string, Record<string, string>>()

/**
 * Block row header for a consent field. The consent field stores only the source id, so this resolves
 * it to the source's name via the same `consent-sources` endpoint the Source select uses, rendering
 * "NN Consent {name}". Falls back to "NN Consent" while loading, when unset, or on an unsaved form
 * (no document id yet, so the endpoint cannot resolve options).
 */
export const ConsentBlockLabel = ({ typeLabelKey }: { typeLabelKey?: string }) => {
	const { data, rowNumber } = useRowLabel<RowData>()
	const { t } = useTranslation()
	const { id, collectionSlug } = useDocumentInfo()
	const { config } = useConfig()
	const source = typeof data?.source === 'string' ? data.source : ''
	const [names, setNames] = useState<Record<string, string>>({})

	useEffect(() => {
		if (id == null || !collectionSlug) {
			return
		}
		const url = buildEndpointOptionsUrl({
			apiRoute: config.routes.api,
			collectionSlug,
			id,
			endpoint: 'consent-sources',
		})
		const cached = nameCache.get(url)
		if (cached) {
			setNames(cached)
			return
		}
		const controller = new AbortController()
		fetch(url, {
			credentials: 'include',
			headers: { Accept: 'application/json' },
			signal: controller.signal,
		})
			.then(async (response) => {
				if (!response.ok) {
					throw new Error(`Options request failed with ${response.status}`)
				}
				const map = Object.fromEntries(
					parseEndpointOptions(await response.json()).map((o) => [o.value, o.label])
				)
				nameCache.set(url, map)
				setNames(map)
			})
			.catch(() => {})
		return () => controller.abort()
	}, [config.routes.api, collectionSlug, id])

	const typeLabel = typeLabelKey ? t(typeLabelKey as TranslationKey) : ''
	const number = String((rowNumber ?? 0) + 1).padStart(2, '0')
	const name = source ? (names[source] ?? '') : ''
	return (
		<span style={{ alignItems: 'center', display: 'inline-flex', gap: '0.5rem' }}>
			<span style={{ color: 'var(--theme-elevation-500)' }}>
				{typeLabel ? `${number} ${typeLabel}` : number}
			</span>
			{name ? <span>{name}</span> : null}
		</span>
	)
}
