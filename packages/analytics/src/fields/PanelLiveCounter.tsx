'use client'

import { useConfig } from '@payloadcms/ui'
import { intlLocale } from '../translations/intl'
import { keys } from '../translations/keys'
import { type PluralPhrase, plural, pluralParts } from '../translations/plural'
import { useTranslation } from '../translations/useTranslation'
import { LiveAnnouncement } from '../ui/components/LiveAnnouncement'
import { useRealtimePoll } from '../ui/hooks/useRealtimePoll'
import { buildPollPath, buildRealtimeEndpoint } from '../widgets/realtimePoll'
import { formatMinutes } from './format'
import '../ui/analytics.css'

const WINDOW_MINUTES = 30
const POLL_MS = 15_000

interface PanelLiveCounterProps {
	collectionSlug: string
	documentId: string
	/** The panel's own source, so the counter reads the same one its cards do. */
	dataSource?: string
}

/**
 * Live visitors on this document's page over the last half hour. A refusal pauses the counter
 * rather than reporting a wrong zero; nothing renders until the first read settles.
 */
export function PanelLiveCounter({
	collectionSlug,
	dataSource,
	documentId,
}: PanelLiveCounterProps) {
	const translation = useTranslation()
	const { t } = translation
	const { config } = useConfig()
	const path = buildPollPath(buildRealtimeEndpoint(config), {
		metric: 'visitors',
		windowMinutes: WINDOW_MINUTES,
		series: false,
		...(dataSource === undefined ? {} : { dataSource }),
	})
	const url = `${path}&collection=${encodeURIComponent(collectionSlug)}&id=${encodeURIComponent(documentId)}`
	const { reading, paused, settled } = useRealtimePoll({ url, intervalMs: POLL_MS })

	if (!settled) {
		return null
	}
	const pausedLabel = t(keys.widgetRealtimePaused)
	const live = paused || reading === null ? null : reading.activeNow
	const phrase: PluralPhrase = {
		name: 'liveVisitors',
		vars: { duration: formatMinutes(WINDOW_MINUTES, intlLocale(translation.i18n.language)) },
	}
	const parts = live === null ? null : pluralParts(translation, phrase, live)
	return (
		<span className="analytics-live analytics-panel__live">
			<span
				aria-hidden="true"
				className={
					parts === null ? 'analytics-live__dot analytics-live__dot--paused' : 'analytics-live__dot'
				}
			/>
			{parts === null ? (
				<span>{pausedLabel}</span>
			) : (
				<span>
					{parts.before}
					<span className="analytics-live__count">{parts.count}</span>
					{parts.after}
				</span>
			)}
			<LiveAnnouncement message={live === null ? pausedLabel : plural(translation, phrase, live)} />
		</span>
	)
}
