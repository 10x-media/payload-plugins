'use client'

import { useCallback, useEffect, useState } from 'react'
import type { FieldAggregation } from '../aggregation/types'
import { Form, type FormProps } from './Form'
import { FormResults } from './FormResults'
import { type FetchResultsResult, fetchFormResults } from './fetchResults'

export type PollProps = FormProps & {
	/** The choice field whose results are shown after voting (should match the form's public `resultsField`). */
	resultsField: string
	/** localStorage key for the per-browser voted guard. Default `fb-poll-{form.id}`. */
	storageKey?: string
	/** Force the voted state (controlled). Omit to use the localStorage guard. */
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
 * A poll: renders `<Form>` until the visitor votes, then fetches the aggregate results and shows
 * `<FormResults>`. A per-browser localStorage flag (`storageKey`) skips straight to results on revisit. The
 * guard is UX, not integrity (bypassable): server-enforced one-per-identity dedup composes via `req.user`
 * (authed forms) or a `notAlreadySubmitted` rule, with cookie/IP identity deferred to the spam phase.
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
	const [voted, setVoted] = useState(false)
	const [results, setResults] = useState<FieldAggregation[] | null>(null)

	const loadResults = useCallback(async () => {
		const result: FetchResultsResult = await fetchResultsImpl({
			formId: formProps.form.id,
			field: resultsField,
			apiRoute,
		})
		setResults(result.ok ? result.results : [])
	}, [fetchResultsImpl, formProps.form.id, resultsField, apiRoute])

	useEffect(() => {
		const already = hasVoted ?? readVoted(key)
		if (already) {
			setVoted(true)
			void loadResults()
		}
	}, [hasVoted, key, loadResults])

	const handleSuccess = useCallback(
		(submissionId?: string) => {
			writeVoted(key)
			setVoted(true)
			void loadResults()
			onSuccess?.(submissionId)
		},
		[key, loadResults, onSuccess]
	)

	if (voted) {
		return results ? (
			<FormResults results={results} t={formProps.t} locale={formProps.locale} />
		) : null
	}

	return <Form {...formProps} apiRoute={apiRoute} onSuccess={handleSuccess} />
}
