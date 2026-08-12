'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FieldAggregation } from '../aggregation/types'
import { isPollClosed, pollConfigOf } from '../form/pollState'
import { answerValues } from '../poll/votes/answerValues'
import type { VotedSubmission } from '../submissions/resolveVotedSubmission'
import { en } from '../translations/en'
import { keys } from '../translations/keys'
import { makeTranslate } from '../translations/makeTranslate'
import type { VoteStorage } from './adapters'
import { Form, type FormProps } from './Form'
import { FormResults } from './FormResults'
import { type FetchResultsResult, fetchFormResults } from './fetchResults'

export type PollProps = FormProps & {
	/** The choice field whose results are shown after voting (should match the form's public `poll.resultsField`). */
	resultsField: string
	/**
	 * Key for the per-browser voted guard (localStorage by default; overridable or disabled via
	 * `adapters.voteStorage`). Default `fb-poll-{form.id}`.
	 */
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
	/**
	 * The voter's server-resolved current vote (`resolveVotedSubmission`, read from the httpOnly voted
	 * cookie). Presence implies voted; `pick` marks the voter's option in results and `value` prefills
	 * the form when they change their vote. Read at mount: after a client-side change the component
	 * tracks the new pick itself.
	 */
	currentVote?: Pick<VotedSubmission, 'value' | 'pick'> | null
}

const localStorageVoteStorage: VoteStorage = {
	read: (key) => {
		try {
			return window.localStorage.getItem(key) != null
		} catch {
			return false
		}
	},
	write: (key) => {
		try {
			window.localStorage.setItem(key, '1')
		} catch {
			// Private mode / storage disabled: the guard is best-effort UX, never integrity.
		}
	},
}

/** `false` disables client persistence entirely (`hasVoted` still marks voted). */
const noopVoteStorage: VoteStorage = { read: () => false, write: () => {} }

const resolveVoteStorage = (configured: VoteStorage | false | undefined): VoteStorage => {
	if (configured === false) {
		return noopVoteStorage
	}
	return configured ?? localStorageVoteStorage
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
	currentVote,
	...formProps
}: PollProps) => {
	const key = storageKey ?? `fb-poll-${formProps.form.id}`
	const poll = formProps.form.poll
	const closed = isPollClosed(poll)
	const allowChange = pollConfigOf(poll)?.allowChange === true
	const winningValues = poll?.outcome?.winningValues
	const finalized = Array.isArray(winningValues) && winningValues.length > 0
	const resultsAwaitClose = !closed && !finalized && poll?.resultsVisibility === 'afterClose'
	// Server-known voted state renders the results view on the very first paint; the effect below
	// only adds the localStorage read.
	const [voted, setVoted] = useState(hasVoted === true || currentVote != null)
	const [changing, setChanging] = useState(false)
	const [pick, setPick] = useState<string[] | undefined>(currentVote?.pick)
	const [prefill, setPrefill] = useState<unknown>(currentVote?.value)
	// Changing is offered only when the signed cookie verifiably identifies a submission: at mount
	// via a resolved `currentVote`, or after an in-session vote (the server just issued the cookie).
	// A localStorage-only voted flag proves nothing about the cookie, and a "change" without one
	// would create a second submission instead of updating.
	const [changeReady, setChangeReady] = useState(currentVote != null)
	const [results, setResults] = useState<FieldAggregation[] | null>(null)
	const [loadFailed, setLoadFailed] = useState(false)
	const translate = useMemo(() => formProps.t ?? makeTranslate(en), [formProps.t])
	const configuredVoteStorage = formProps.adapters?.voteStorage
	const voteStorage = useMemo(
		() => resolveVoteStorage(configuredVoteStorage),
		[configuredVoteStorage]
	)

	const loadResults = useCallback(async () => {
		const result: FetchResultsResult = await fetchResultsImpl({
			formId: formProps.form.id,
			field: resultsField,
			apiRoute,
		})
		// A failed load surfaces as an error, not an empty result set: `[]` would read as "no votes yet".
		if (result.ok) {
			setResults(result.results)
			setLoadFailed(false)
		} else {
			setLoadFailed(true)
		}
	}, [fetchResultsImpl, formProps.form.id, resultsField, apiRoute])

	const resultsError = (
		<p className="fb-poll__error" role="alert">
			{translate(keys.pollResultsError)}
		</p>
	)

	useEffect(() => {
		const already = hasVoted === true || currentVote != null || voteStorage.read(key)
		if (already) {
			setVoted(true)
		}
		if ((already && !resultsAwaitClose) || closed || finalized) {
			void loadResults()
		}
	}, [hasVoted, currentVote, key, loadResults, closed, resultsAwaitClose, finalized, voteStorage])

	const handleSuccess = useCallback<NonNullable<FormProps['onSuccess']>>(
		(submissionId, result) => {
			voteStorage.write(key)
			setVoted(true)
			setChanging(false)
			setChangeReady(true)
			// Track the pick client-side so the "your vote" marker is fresh right after a (re-)vote,
			// without waiting for a server-resolved currentVote on the next page load.
			if (result?.values) {
				const entry = result.values.find((row) => row.field === resultsField)
				setPrefill(entry?.value)
				setPick(answerValues(result.values, resultsField))
			}
			if (!resultsAwaitClose) {
				void loadResults()
			}
			// Forward the resolved success response so a Poll host gets the same onSuccess payload as a Form host.
			onSuccess?.(submissionId, result)
		},
		[key, loadResults, onSuccess, resultsAwaitClose, voteStorage, resultsField]
	)

	if (finalized) {
		return (
			<div className="fb-poll fb-poll--final">
				<p className="fb-poll__final">{translate(keys.pollFinalResult)}</p>
				{loadFailed ? (
					resultsError
				) : results ? (
					<FormResults
						results={results}
						winningValues={winningValues}
						currentValues={pick}
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
				{loadFailed ? (
					resultsError
				) : results ? (
					<FormResults
						results={results}
						currentValues={pick}
						t={formProps.t}
						locale={formProps.locale}
					/>
				) : null}
			</div>
		)
	}

	if (voted && !changing) {
		if (resultsAwaitClose) {
			return <p className="fb-poll__await-close">{translate(keys.pollResultsAfterClose)}</p>
		}
		if (loadFailed) {
			return resultsError
		}
		return results ? (
			<div className="fb-poll fb-poll--voted">
				<FormResults
					results={results}
					currentValues={pick}
					t={formProps.t}
					locale={formProps.locale}
				/>
				{allowChange && changeReady ? (
					<button className="fb-poll__change" type="button" onClick={() => setChanging(true)}>
						{translate(keys.pollChangeVote)}
					</button>
				) : null}
			</div>
		) : null
	}

	// While changing, the current pick prefills the results field; the server identifies the
	// submission to update from the httpOnly voted cookie, so the client sends a normal submit.
	const initialValues =
		changing && prefill !== undefined
			? { ...(formProps.initialValues ?? {}), [resultsField]: prefill }
			: formProps.initialValues
	return (
		<Form
			{...formProps}
			initialValues={initialValues}
			apiRoute={apiRoute}
			onSuccess={handleSuccess}
		/>
	)
}
