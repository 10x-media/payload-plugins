'use client'

import { useFormFields } from '@payloadcms/ui'
import type React from 'react'

import './dev.css'

/** Last year's numbers, the sort of thing a recruiting team keeps to hand. */
const DAYS_TO_HIRE: Record<string, Record<string, number>> = {
	design: { junior: 26, mid: 34, principal: 71, senior: 48, staff: 62 },
	engineering: { junior: 29, mid: 38, principal: 84, senior: 52, staff: 67 },
	marketing: { junior: 21, mid: 29, principal: 58, senior: 37, staff: 46 },
	operations: { junior: 18, mid: 25, principal: 49, senior: 33, staff: 41 },
	product: { junior: 31, mid: 40, principal: 79, senior: 55, staff: 68 },
	sales: { junior: 19, mid: 27, principal: 52, senior: 35, staff: 44 },
}

/**
 * A component item: a consumer's own component sitting between the fields of a field step,
 * rendered in the step's flow rather than as a step of its own. It reads the fields above it
 * through Payload's `useFormFields`, since a step's fields are the document's real form state.
 */
export const RoleHint: React.FC = () => {
	const department = useFormFields(([fields]) => fields.department?.value as string | undefined)
	const seniority = useFormFields(([fields]) => fields.seniority?.value as string | undefined)
	const headcount = useFormFields(([fields]) => fields.headcount?.value as number | undefined)

	if (!department || !seniority) {
		return (
			<p className="dev-hint dev-muted">
				Pick a team and a level to see how long the last comparable search took.
			</p>
		)
	}

	const days = DAYS_TO_HIRE[department]?.[seniority]
	if (!days) {
		return null
	}

	return (
		<p className="dev-hint">
			The last {seniority} hire in {department} took <strong>{days} days</strong> from posting to
			signature.
			{headcount && headcount > 1
				? ` Opening ${headcount} of them at once usually adds a fortnight.`
				: ' Budget two rounds of interviews and a take-home.'}
		</p>
	)
}
