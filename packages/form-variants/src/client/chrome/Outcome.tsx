'use client'

import type React from 'react'

import { BASE_CLASS } from '../../plugin/constants'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { useOutcome } from '../context'

/**
 * A bare fallback so `finish({ title, message })` shows something when no `Outcome` slot is
 * set. What the screen looks like and what the user can do next (open the record, create
 * another, close the drawer) is the consumer's: set the `Outcome` slot and read the data
 * through `useOutcome()`.
 */
export const Outcome: React.FC = () => {
	const { t } = useTranslation()
	const outcome = useOutcome()
	if (!outcome) {
		return null
	}
	const { message, title } = outcome
	return (
		<section className={`${BASE_CLASS}__outcome`}>
			<h2>{typeof title === 'string' ? title : t(keys.done)}</h2>
			{typeof message === 'string' && <p>{message}</p>}
		</section>
	)
}
