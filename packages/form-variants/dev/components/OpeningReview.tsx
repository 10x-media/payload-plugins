'use client'

import { useWizard, useWizardState } from '@10x-media/form-variants/client'
import { useFormFields } from '@payloadcms/ui'
import type React from 'react'
import { useEffect } from 'react'

import './dev.css'

const WORKPLACE: Record<string, string> = {
	hybrid: 'Hybrid',
	onsite: 'On site',
	remote: 'Remote',
}

const money = (currency: string, low?: number, high?: number): string => {
	if (!low && !high) {
		return 'Not stated'
	}
	const format = (value?: number) => (value ? value.toLocaleString('en-GB') : '?')
	return `${currency} ${format(low)} – ${format(high)}`
}

/**
 * A component step: the plugin renders it in place of a field step and gives it the wizard API.
 * This one reads the whole form back through Payload's own `useFormFields`, keeps its answer in
 * wizard state so it survives a walk back through the steps, and holds the save with
 * `blockSave` until the answer is yes.
 *
 * It draws no buttons of its own. The footer's Publish is the variant's, held shut by the
 * guard, which is why the screen has one obvious place to save rather than two.
 */
export const OpeningReview: React.FC = () => {
	const { allowSave, blockSave, setMessage } = useWizard()
	const [confirmed, setConfirmed] = useWizardState<boolean>('reviewConfirmed')

	const title = useFormFields(([fields]) => fields.title?.value as string | undefined)
	const department = useFormFields(([fields]) => fields.department?.value as string | undefined)
	const seniority = useFormFields(([fields]) => fields.seniority?.value as string | undefined)
	const workplace = useFormFields(([fields]) => fields.workplace?.value as string | undefined)
	const city = useFormFields(([fields]) => fields['location.city']?.value as string | undefined)
	const currency = useFormFields(
		([fields]) => fields['compensation.currency']?.value as string | undefined
	)
	const low = useFormFields(([fields]) => fields['compensation.min']?.value as number | undefined)
	const high = useFormFields(([fields]) => fields['compensation.max']?.value as number | undefined)
	const summary = useFormFields(([fields]) => fields.summary?.value as string | undefined)

	useEffect(() => {
		if (confirmed) {
			allowSave()
			setMessage(null)
			return
		}
		blockSave('Confirm the summary before the posting goes out.')
	}, [allowSave, blockSave, confirmed, setMessage])

	// The guard is the runner's, not this step's: leaving the step has to release it.
	useEffect(() => allowSave, [allowSave])

	return (
		<div className="dev-stack">
			<dl className="dev-review">
				<div className="dev-review__row">
					<dt>Role</dt>
					<dd>{title || <span className="dev-muted">Untitled</span>}</dd>
				</div>
				<div className="dev-review__row">
					<dt>Team</dt>
					<dd>{department ? `${department}, ${seniority ?? 'level not set'}` : 'Not set'}</dd>
				</div>
				<div className="dev-review__row">
					<dt>Where</dt>
					<dd>
						{workplace ? (WORKPLACE[workplace] ?? workplace) : 'Not set'}
						{city ? ` — ${city}` : ''}
					</dd>
				</div>
				<div className="dev-review__row">
					<dt>Range</dt>
					<dd>{money(currency ?? 'EUR', low, high)}</dd>
				</div>
				<div className="dev-review__row">
					<dt>Summary</dt>
					<dd>{summary || <span className="dev-muted">Nothing written yet</span>}</dd>
				</div>
			</dl>
			{/* A plain input on purpose: the answer belongs to wizard state, not to the document, so
			    it must not become a field Payload would try to save. */}
			<label className="dev-confirm">
				<input
					checked={Boolean(confirmed)}
					onChange={(event) => setConfirmed(event.target.checked)}
					type="checkbox"
				/>
				Everything above is right, publish it
			</label>
		</div>
	)
}
