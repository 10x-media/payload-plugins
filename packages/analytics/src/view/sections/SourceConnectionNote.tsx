'use client'

import { useEffect, useState } from 'react'
import {
	isProviderStatusResponse,
	type ProviderStatus,
	vendorWordsOf,
} from '../../providers/connectionState'
import { documentIdOf, PROVIDER_NAMES } from '../../providers/ids'
import { dateTimeFormat } from '../../translations/intl'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { requestShaped } from '../../ui/data/request'
import { viewerNow } from '../../ui/viewerClock'

interface SourceConnectionNoteProps {
	/** The provider status endpoint; absent on an install without provider documents. */
	endpoint: string | undefined
	sourceId: string
	locale: string
}

/**
 * What the vendor said when it refused a provider document's source, and until when reads rest,
 * inside the view's error banner. Shown only to a reader who may read the document; nothing for anyone
 * else, nor for a source no document gives.
 */
export function SourceConnectionNote({ endpoint, sourceId, locale }: SourceConnectionNoteProps) {
	const { t } = useTranslation()
	const [status, setStatus] = useState<ProviderStatus>()
	const docId = documentIdOf(sourceId)
	const url =
		endpoint === undefined || docId === undefined
			? undefined
			: `${endpoint}?id=${encodeURIComponent(docId)}`

	useEffect(() => {
		if (url === undefined) {
			return
		}
		const controller = new AbortController()
		// A reader the document is closed to is answered 404: the error above says enough.
		requestShaped(url, isProviderStatusResponse, { signal: controller.signal }).then(
			(answer) => setStatus(answer.status),
			() => {}
		)
		return () => controller.abort()
	}, [url])

	const words = status?.errorDetail ? vendorWordsOf(status.errorDetail) : undefined
	const pausedAt = status?.pausedUntil ? Date.parse(status.pausedUntil) : Number.NaN
	const pausedUntil =
		pausedAt > viewerNow().getTime()
			? dateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(pausedAt)
			: undefined
	if (!words && !pausedUntil) {
		return null
	}
	return (
		<>
			{words ? (
				<span className="analytics-view__source-note">
					{words.provider ? `${t(PROVIDER_NAMES[words.provider])}: ` : null}
					{words.message}
				</span>
			) : null}
			{pausedUntil ? (
				<span className="analytics-view__source-note">
					{t(keys.providerConnectionPaused, { date: pausedUntil })}
				</span>
			) : null}
		</>
	)
}
