'use client'

import type { ReactNode } from 'react'
import type { FieldAggregation } from '../aggregation/types'
import { en } from '../translations/en'
import { keys } from '../translations/keys'
import { makeTranslate } from '../translations/makeTranslate'
import type { RendererTranslate } from './contract'

export type FormResultsProps = {
	/** One field aggregation or several (a survey summary), resolved server-side and passed in. */
	results: FieldAggregation | FieldAggregation[]
	/** Localized translator for built-in copy. Defaults to identity (returns the key). */
	t?: RendererTranslate
	locale?: string
	/** Show the raw count beside each option. Default true. */
	showCounts?: boolean
	/** The recorded outcome's stable option values; every matching bucket is highlighted as a winner (a tie highlights more than one). */
	winningValues?: string[]
	/** The viewing voter's own pick (e.g. `resolveVotedSubmission().pick`); every matching bucket carries a "your vote" marker. */
	currentValues?: string[]
}

const OneResult = ({
	result,
	t,
	showCounts,
	winningValues,
	currentValues,
}: {
	result: FieldAggregation
	t: RendererTranslate
	showCounts: boolean
	winningValues?: string[]
	currentValues?: string[]
}): ReactNode => {
	if (result.total === 0) {
		return (
			<section className="fb-results__field">
				{result.label ? <h3 className="fb-results__label">{result.label}</h3> : null}
				<p className="fb-results__empty">{t(keys.resultsNoResponses)}</p>
			</section>
		)
	}
	return (
		<section className="fb-results__field">
			{result.label ? <h3 className="fb-results__label">{result.label}</h3> : null}
			<ul className="fb-results__list">
				{result.buckets.map((bucket) => {
					const isWinner = winningValues?.includes(bucket.value) ?? false
					const isYours = currentValues?.includes(bucket.value) ?? false
					const rowClass = [
						'fb-results__row',
						...(isWinner ? ['fb-results__bucket--winner'] : []),
						...(isYours ? ['fb-results__bucket--yours'] : []),
					].join(' ')
					return (
						<li key={bucket.value} className={rowClass}>
							<span className="fb-results__option">
								{bucket.label}
								{isWinner ? (
									<span className="fb-results__winner-badge">{t(keys.resultsWinner)}</span>
								) : null}
								{isYours ? (
									<span className="fb-results__your-vote-badge">{t(keys.resultsYourVote)}</span>
								) : null}
							</span>
							<span className="fb-results__bar">
								<span
									className="fb-results__bar-fill"
									style={{ width: `${bucket.percentage}%` }}
									aria-hidden="true"
								/>
							</span>
							<span className="fb-results__pct">{bucket.percentage}%</span>
							{showCounts ? <span className="fb-results__count">{bucket.count}</span> : null}
						</li>
					)
				})}
			</ul>
			<p className="fb-results__total">
				{result.total} {t(keys.resultsResponses)}
				{result.truncated ? ` (${t(keys.resultsTruncated)})` : ''}
			</p>
		</section>
	)
}

/**
 * Presentational results view for polls and survey summaries: per-option bars with percentages. Headless,
 * data resolved server-side via `aggregateFieldResponses`/`aggregateFormResponses` and passed in (it never
 * fetches). The option label, count, and percentage are real text (the accessible content); the bar fill
 * is `aria-hidden` visual sugar sized by inline width. With `winningValues`, every matching bucket gets
 * the winner class and a translated badge (real text, so the outcome is accessible); a tie highlights more than one.
 */
export const FormResults = ({
	results,
	t,
	showCounts = true,
	winningValues,
	currentValues,
}: FormResultsProps): ReactNode => {
	const translate: RendererTranslate = t ?? makeTranslate(en)
	const list = Array.isArray(results) ? results : [results]
	return (
		<div className="fb-results">
			{list.map((result) => (
				<OneResult
					key={result.field}
					result={result}
					t={translate}
					showCounts={showCounts}
					winningValues={winningValues}
					currentValues={currentValues}
				/>
			))}
		</div>
	)
}
