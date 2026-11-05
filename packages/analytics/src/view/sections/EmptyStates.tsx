'use client'

import { Banner, Button, ShimmerEffect } from '@payloadcms/ui'
import { AnalyticsEmptyState } from '../../fields/emptyState'
import { formatDuration } from '../../fields/format'
import { askedAboutNoGoals, type QueryResponse } from '../../query/response'
import { intlLocale } from '../../translations/intl'
import { keys, type TranslationKey } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { cssPx } from '../../ui/cssVars'
import type { RequestFailure } from '../../ui/data/request'
import { emptyGoalsKey } from '../../widgets/stateKeys'
import type { QueryState } from '../useViewQueries'

const DOCS_URL = 'https://docs.10xmedia.de/analytics/quick-start'

export interface SectionErrorProps {
	/** Absent reads as a failure nothing more is known about. */
	error?: RequestFailure | undefined
	onRetry: () => void
}

const UNKNOWN: RequestFailure = { code: 'failed' }

/**
 * A failure of the source itself rather than of one report: it is misconfigured, gone, or closed
 * to the reader, so every section fails alike and the overview says it once for all of them.
 */
export const isSourceFailure = (error: RequestFailure | undefined): boolean =>
	error?.code === 'source_misconfigured' ||
	error?.code === 'not_found' ||
	error?.code === 'forbidden'

interface Wording {
	message: TranslationKey
	/** Trying again can help, so the section offers it. */
	retry: boolean
	retryAfter?: number
}

const wordingOf = (error: Exclude<RequestFailure, { code: 'unsupported' }>): Wording => {
	switch (error.code) {
		case 'invalid_param':
			return { message: keys.viewErrorInvalid, retry: false }
		case 'range_too_long':
			return { message: keys.stateRangeTooLong, retry: false }
		case 'source_misconfigured':
			return {
				message: error.hostRefused ? keys.viewErrorHostRefused : keys.viewErrorMisconfigured,
				retry: false,
			}
		case 'not_found':
			return { message: keys.viewErrorNotFound, retry: false }
		case 'forbidden':
			return { message: keys.viewErrorForbidden, retry: false }
		case 'unavailable':
			return { message: keys.viewErrorBusy, retry: true, retryAfter: error.retryAfter }
		case 'rate_limited':
			return { message: keys.viewErrorTooManyReads, retry: true, retryAfter: error.retryAfter }
		case 'failed':
			return { message: keys.viewErrorGeneric, retry: true }
	}
}

/** "Try again in 30 seconds." for a wait the source named in seconds; nothing without one. */
export function RetryAfter({
	seconds,
	className,
}: {
	seconds: number | undefined
	className: string
}) {
	const { t, i18n } = useTranslation()
	if (seconds === undefined) {
		return null
	}
	return (
		<span className={className}>
			{t(keys.viewErrorRetryAfter, {
				duration: formatDuration(seconds * 1000, intlLocale(i18n.language)),
			})}
		</span>
	)
}

/**
 * How a section reports a failed read: unsupported is an empty state; refused, denied, vanished or
 * misconfigured is final; outage, rate limit or unknown is transient and offers a retry.
 */
export function SectionError({ error = UNKNOWN, onRetry }: SectionErrorProps) {
	const { t } = useTranslation()
	if (error.code === 'unsupported') {
		return <AnalyticsEmptyState isNew={false}>{t(keys.viewSectionUnavailable)}</AnalyticsEmptyState>
	}
	const { message, retry, retryAfter } = wordingOf(error)
	return (
		<div className="analytics-view__error">
			<Banner type="error">{t(message)}</Banner>
			<RetryAfter className="analytics-view__caption" seconds={retryAfter} />
			{retry ? (
				<Button buttonStyle="secondary" onClick={onRetry} size="small">
					{t(keys.viewRetry)}
				</Button>
			) : null}
		</div>
	)
}

/** A section's {@link SectionError} while its latest read failed, above any answer it kept. */
export function QueryError({ query }: { query: QueryState<unknown> }) {
	return query.status === 'error' ? (
		<SectionError error={query.error} onRetry={query.refetch} />
	) : null
}

/** What an empty goal breakdown says, worded as the goal widgets word it. */
export const goalsEmptyLabel = (data: QueryResponse | undefined): TranslationKey =>
	emptyGoalsKey({
		goalsUnresolved: data?.result.meta.goalsUnresolved,
		noGoals: askedAboutNoGoals(data),
	})

/** A section whose read succeeded with nothing in it. */
export function SectionEmpty({ label }: { label?: TranslationKey }) {
	const { t } = useTranslation()
	return <span className="analytics-view__empty">{t(label ?? keys.stateNoData)}</span>
}

export interface SkeletonProps {
	/** How many cards, table rows or plots the answer will fill. */
	rows: number
	/**
	 * The shape stood in for: `card` an overview card, `bars` a ranked table as the breakdowns
	 * draw it, `table` a plain one as the goals panel does, `chart` a plot.
	 */
	variant?: 'card' | 'bars' | 'table' | 'chart'
	/** A card's comparison line under its number, there while the view compares. */
	delta?: boolean
	/** A plot's height in pixels, the stylesheet's own without it. */
	height?: number
}

const Shimmer = ({ part }: { part?: 'label' | 'value' | 'delta' }) => (
	<ShimmerEffect
		aria-hidden="true"
		className={
			part
				? `analytics-view__skeleton analytics-view__skeleton--${part}`
				: 'analytics-view__skeleton'
		}
		disableInlineStyles
	/>
)

/**
 * Payload's shimmer shaped like the answer it stands in for; sizes come from the same stylesheet
 * lengths as the chrome, so the answer moves nothing when it lands.
 */
export function Skeleton({ rows, variant = 'card', delta = false, height }: SkeletonProps) {
	const slots = Array.from({ length: rows }, (_, slot) => slot)
	if (variant === 'card') {
		return slots.map((slot) => (
			<div
				aria-hidden="true"
				className="analytics-card analytics-metric analytics-view__card"
				key={slot}
			>
				<Shimmer part="label" />
				<Shimmer part="value" />
				{delta ? <Shimmer part="delta" /> : null}
			</div>
		))
	}
	if (variant === 'chart') {
		return slots.map((slot) => (
			<ShimmerEffect
				aria-hidden="true"
				className="analytics-view__skeleton analytics-view__skeleton--chart"
				disableInlineStyles
				key={slot}
				{...(height === undefined ? {} : { style: { '--analytics-chart-height': cssPx(height) } })}
			/>
		))
	}
	return (
		<div
			aria-hidden="true"
			className={`analytics-view__skeleton-table analytics-view__skeleton-table--${variant}`}
		>
			{slots.map((slot) => (
				<Shimmer key={slot} />
			))}
		</div>
	)
}

/**
 * Whole-page state for a scope with no readable source. A reader who works per site and has none
 * selected is asked to pick one instead, since connecting a source is not what they miss.
 */
export function NoSources({ needsScope = false }: { needsScope?: boolean }) {
	const { t } = useTranslation()
	if (needsScope) {
		return (
			<div className="analytics-view__no-sources">
				<strong>{t(keys.stateNoScope)}</strong>
			</div>
		)
	}
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
