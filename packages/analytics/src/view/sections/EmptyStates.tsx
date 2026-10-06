'use client'

import { Banner, Button } from '@payloadcms/ui'
import { AnalyticsEmptyState } from '../../fields/emptyState'
import { QueryFetchError } from '../../query/fetchQuery'
import { keys, type TranslationKey } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { SECTION_UNAVAILABLE } from '../useViewQueries'

const DOCS_URL = 'https://docs.10xmedia.de/analytics/quick-start'

/** Status codes the reader cannot retry their way out of. */
const FINAL: Record<number, TranslationKey> = {
	403: keys.viewErrorForbidden,
	404: keys.viewErrorNotFound,
}

export interface SectionErrorProps {
	error: Error
	onRetry: () => void
}

/**
 * How one section reports a read it could not make. A source that serves nothing for the
 * section is an empty state rather than a failure; a denied or vanished source is a final
 * answer with no retry; everything else is transient and offers one, with the provider's
 * own `Retry-After` when it sent one.
 */
export function SectionError({ error, onRetry }: SectionErrorProps) {
	const { t } = useTranslation()
	if (error.message === SECTION_UNAVAILABLE) {
		return <AnalyticsEmptyState isNew={false}>{t(keys.viewSectionUnavailable)}</AnalyticsEmptyState>
	}
	const status = error instanceof QueryFetchError ? error.status : 0
	const retryAfter = error instanceof QueryFetchError ? error.retryAfter : undefined
	const final = FINAL[status]
	const message = final ?? (status === 503 ? keys.viewErrorBusy : keys.viewErrorGeneric)
	return (
		<div className="analytics-view__error">
			<Banner type="error">{t(message)}</Banner>
			{retryAfter === undefined ? null : (
				<span className="analytics-view__caption">
					{`${t(keys.viewErrorRetryAfter)} ${retryAfter}s`}
				</span>
			)}
			{final === undefined ? (
				<Button buttonStyle="secondary" onClick={onRetry} size="small">
					{t(keys.viewRetry)}
				</Button>
			) : null}
		</div>
	)
}

/** A section whose read succeeded with nothing in it. */
export function SectionEmpty({ label }: { label?: TranslationKey }) {
	const { t } = useTranslation()
	return <span className="analytics-view__empty">{t(label ?? keys.stateNoData)}</span>
}

export interface SkeletonProps {
	rows: number
	variant?: 'card' | 'row' | 'chart'
}

/** Placeholder blocks for a first read, in the same chrome the answer will fill. */
export function Skeleton({ rows, variant = 'card' }: SkeletonProps) {
	return (
		<>
			{Array.from({ length: rows }, (_, index) => (
				<div
					aria-hidden="true"
					className={`analytics-view__skeleton${variant === 'card' ? '' : ` analytics-view__skeleton--${variant}`}`}
					// biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
					key={index}
				/>
			))}
		</>
	)
}

/**
 * The whole-page state for a reader whose scope has no readable source: nothing to gate,
 * nothing to retry, just what to do about it.
 */
export function NoSources() {
	const { t } = useTranslation()
	return (
		<div className="analytics-view__no-sources">
			<strong>{t(keys.viewNoSources)}</strong>
			<span className="analytics-view__empty">{t(keys.viewNoSourcesHelp)}</span>
			<a href={DOCS_URL} rel="noreferrer" target="_blank">
				{t(keys.viewDocsLink)}
			</a>
		</div>
	)
}
