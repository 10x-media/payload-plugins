'use client'

import { Button, useDocumentInfo, useForm, useFormFields } from '@payloadcms/ui'
import { useState } from 'react'
import { keys, type TranslationKey } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'

/** The help line under the button when closing, tailored to the strategy that closing will apply. */
const closeHintKeyFor = (type: string): TranslationKey => {
	if (type === 'mostVoted') {
		return keys.pollCloseHintMostVoted
	}
	if (type === 'source') {
		return keys.pollCloseHintSource
	}
	return keys.pollCloseHintManual
}

const strOf = (value: unknown): string =>
	typeof value === 'string' && value.length > 0 ? value : 'manual'

/** True once a `closesAt` is set (scheduled or past): the toggle treats that as closed/finalized. */
const isClosed = (value: unknown): boolean => typeof value === 'string' && value.length > 0

/** True when the winner set holds at least one non-empty value. */
const hasWinner = (value: unknown): boolean =>
	Array.isArray(value) && value.some((entry) => typeof entry === 'string' && entry.length > 0)

const asRecord = (value: unknown): Record<string, unknown> =>
	value != null && typeof value === 'object' ? (value as Record<string, unknown>) : {}

/**
 * The `poll.closePoll` UI field: one button that closes the poll and, once closed, reopens it, by
 * saving the whole document rather than calling the `/:id/close` endpoint. Closing stamps
 * `poll.closesAt` now while keeping the admin's just-picked winner, so both persist together through
 * the normal save (`pollOutcomeBeforeChange` validates the winner and stamps `resolvedAt`; the
 * `afterChange` hook enqueues the close for a `mostVoted`/`source` strategy). Reopening clears both
 * `closesAt` and `winningValues`, since either one keeps a poll finalized. A `manual` poll with no
 * winner selected disables the button (there is nothing to record); `mostVoted`/`source` stay enabled
 * because the winner is server-computed. Disabled on an unsaved document (no id yet).
 */
export const ClosePollButton = () => {
	const { t } = useTranslation()
	const { id } = useDocumentInfo()
	const { getDataByPath, submit } = useForm()
	const type = useFormFields(([fields]) => strOf(fields?.['poll.type']?.value))
	const closed = useFormFields(([fields]) => isClosed(fields?.['poll.closesAt']?.value))
	const winnerSet = useFormFields(([fields]) =>
		hasWinner(fields?.['poll.outcome.winningValues']?.value)
	)
	const [submitting, setSubmitting] = useState(false)

	const manualNeedsWinner = !closed && type === 'manual' && !winnerSet
	const disabled = id == null || submitting || manualNeedsWinner

	const save = async (nextPoll: (poll: Record<string, unknown>) => Record<string, unknown>) => {
		if (id == null) {
			return
		}
		setSubmitting(true)
		try {
			// Rebuild the whole poll group from live form state and override it in one shot: a shallow
			// top-level override, so the winner and every other poll field are preserved (a dotted
			// `poll.closesAt` override key never reaches the nested field on the server).
			const poll = asRecord(getDataByPath('poll'))
			await submit({ overrides: { poll: nextPoll(poll) } })
		} finally {
			setSubmitting(false)
		}
	}

	const close = () => save((poll) => ({ ...poll, closesAt: new Date().toISOString() }))
	const reopen = () =>
		save((poll) => ({
			...poll,
			closesAt: null,
			outcome: { ...asRecord(poll.outcome), winningValues: [] },
		}))

	const hintKey: TranslationKey = closed
		? keys.pollReopenHint
		: manualNeedsWinner
			? keys.pollCloseNeedsWinner
			: closeHintKeyFor(type)

	return (
		<div className="field-type" style={{ marginBlockEnd: '1rem' }}>
			<Button buttonStyle="secondary" onClick={closed ? reopen : close} disabled={disabled}>
				{t(closed ? keys.pollReopenButton : keys.pollCloseButton)}
			</Button>
			<p className="field-description" style={{ marginBlockStart: '0.5rem' }}>
				{t(hintKey)}
			</p>
		</div>
	)
}
