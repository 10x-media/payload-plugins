'use client'

import { useEffect, useState } from 'react'
import { isProviderStatusResponse, type ProviderStatus } from '../../providers/connectionState'
import { documentIdOf } from '../../providers/ids'
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
 * under the view's error. Shown only to a reader who may read the document; nothing for anyone
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

	const detail = status?.errorDetail
	const pausedAt = status?.pausedUntil ? Date.parse(status.pausedUntil) : Number.NaN
	const pausedUntil =
		pausedAt > viewerNow().getTime()
			? dateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(pausedAt)
			: undefined
	if (!detail && !pausedUntil) {
		return null
	}
	return (
		<ul className="analytics-view__caption analytics-view__source-note">
			{detail ? <li>{t(keys.viewErrorVendorSaid, { detail })}</li> : null}
			{pausedUntil ? <li>{t(keys.providerConnectionPaused, { date: pausedUntil })}</li> : null}
		</ul>
	)
}
