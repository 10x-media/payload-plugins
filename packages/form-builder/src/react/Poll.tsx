'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FieldAggregation } from '../aggregation/types'
import { isPollClosed } from '../form/pollState'
import { en } from '../translations/en'
import { keys } from '../translations/keys'
import { makeTranslate } from '../translations/makeTranslate'
import { Form, type FormProps } from './Form'
import { FormResults } from './FormResults'
import { type FetchResultsResult, fetchFormResults } from './fetchResults'

export type PollProps = FormProps & {
	/** The choice field whose results are shown after voting (should match the form's public `poll.resultsField`). */
	resultsField: string
	/** localStorage key for the per-browser voted guard. Default `fb-poll-{form.id}`. */
	storageKey?: string
	/**
	 * Server-known voted state, ORed with the localStorage guard: `true` marks the visitor as voted;
	 * `false`/omitted falls back to localStorage. SSR hosts using the plugin's `poll.votedCookie`
	 * option pass `hasVotedCookie(cookieHeader, form.id)` here.
	 */
	hasVoted?: boolean
	/**
	 * Injectable results fetch (testing); defaults to `fetchFormResults`. Pass a stable reference (module
	 * scope, `useCallback`, or `useMemo`): an inline function re-runs the load effect and double-fetches.
	 */
	fetchResultsImpl?: typeof fetchFormResults
}

const readVoted = (key: string): boolean => {
	try {
		return window.localStorage.getItem(key) != null
	} catch {
		return false
	}
}

const writeVoted = (key: string): void => {
	try {
		window.localStorage.setItem(key, '1')
	} catch {
		// Private mode / storage disabled: the guard is best-effort UX, never integrity.
	}
}

/**
 * A poll: renders `<Form>` while open and not yet voted, then fetches the aggregate results and shows
 * `<FormResults>`. Lifecycle comes from `form.poll`: past `closesAt` the poll is closed (a translated
 * notice plus results, which the endpoint serves for any visibility once closed); a voted-but-open
 * `afterClose` poll shows a translated wait notice instead of fetching (the endpoint would refuse). A
 * recorded `outcome.winningValues` (via `resolvePollOutcome`) supersedes everything: a translated final
 * notice plus results with every winning bucket highlighted (a tie highlights more than one). A
 * per-browser localStorage flag (`storageKey`) skips straight to results on revisit; `hasVoted: true`
 * (e.g. from the server-set voted cookie) marks voted regardless of localStorage. The guard is UX, not
 * integrity (bypassable): server-enforced
 * one-per-identity dedup composes via `req.user` (authed forms) or a `notAlreadySubmitted` rule.
 */
export const Poll = ({
	resultsField,
	storageKey,
	hasVoted,
	fetchResultsImpl = fetchFormResults,
	apiRoute,
	onSuccess,
	...formProps
}: PollProps) => {
	const key = storageKey ?? `fb-poll-${formProps.form.id}`
	const poll = formProps.form.poll
	const closed = isPollClosed(poll)
	const winningValues = poll?.outcome?.winningValues
	const finalized = Array.isArray(winningValues) && winningValues.length > 0
	const resultsAwaitClose = !closed && !finalized && poll?.resultsVisibility === 'afterClose'
	const [voted, setVoted] = useState(false)
	const [results, setResults] = useState<FieldAggregation[] | null>(null)
	const translate = useMemo(() => formProps.t ?? makeTranslate(en), [formProps.t])

	const loadResults = useCallback(async () => {
		const result: FetchResultsResult = await fetchResultsImpl({
			formId: formProps.form.id,
			field: resultsField,
			apiRoute,
		})
		setResults(result.ok ? result.results : [])
	}, [fetchResultsImpl, formProps.form.id, resultsField, apiRoute])

	useEffect(() => {
		const already = hasVoted === true || readVoted(key)
		if (already) {
			setVoted(true)
		}
		if ((already && !resultsAwaitClose) || closed || finalized) {
			void loadResults()
		}
	}, [hasVoted, key, loadResults, closed, resultsAwaitClose, finalized])

	const handleSuccess = useCallback(
		(submissionId?: string) => {
			writeVoted(key)
			setVoted(true)
			if (!resultsAwaitClose) {
				void loadResults()
			}
			onSuccess?.(submissionId)
		},
		[key, loadResults, onSuccess, resultsAwaitClose]
	)

	if (finalized) {
		return (
			<div className="fb-poll fb-poll--final">
				<p className="fb-poll__final">{translate(keys.pollFinalResult)}</p>
				{results ? (
					<FormResults
						results={results}
						winningValues={winningValues}
						t={formProps.t}
						locale={formProps.locale}
					/>
				) : null}
			</div>
		)
	}

	if (closed) {
		return (
			<div className="fb-poll fb-poll--closed">
				<p className="fb-poll__closed">{translate(keys.pollClosed)}</p>
				{results ? (
					<FormResults results={results} t={formProps.t} locale={formProps.locale} />
				) : null}
			</div>
		)
	}

	if (voted) {
		if (resultsAwaitClose) {
			return <p className="fb-poll__await-close">{translate(keys.pollResultsAfterClose)}</p>
		}
		return results ? (
			<FormResults results={results} t={formProps.t} locale={formProps.locale} />
		) : null
	}

	return <Form {...formProps} apiRoute={apiRoute} onSuccess={handleSuccess} />
}
