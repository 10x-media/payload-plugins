'use client'

import { defineFieldRenderer } from '@10x-media/form-builder/react'

type AthleteOption = { label: string; value: string }

/**
 * Frontend renderer for the `athleteVote` field type. The voteable athletes reach the client as the
 * field's `options`, injected server-side by `toFormDocument({ pollOptions })` from the field's
 * `resolveOptions`, so this component never fetches: it renders them as an accessible radio-card
 * group. A fieldset/legend names the whole set and each athlete is its own labelled radio, which is
 * also how the e2e test picks one by athlete name.
 */
export const athleteVoteRenderer = defineFieldRenderer(
	({ field, name, value, onChange, onBlur, errors, required }) => {
		const options = Array.isArray(field.options) ? (field.options as AthleteOption[]) : []
		const selected = typeof value === 'string' ? value : undefined
		const label = typeof field.label === 'string' ? field.label : undefined
		const errorId = `${name}-error`
		return (
			<fieldset
				style={{ border: 0, margin: 0, padding: 0 }}
				aria-describedby={errors.length > 0 ? errorId : undefined}
			>
				{label ? (
					<legend style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
						{label}
						{required ? <span aria-hidden="true"> *</span> : null}
					</legend>
				) : null}
				<div style={{ display: 'grid', gap: '0.5rem' }}>
					{options.map((option) => {
						const checked = selected === option.value
						return (
							<label
								key={option.value}
								style={{
									display: 'flex',
									alignItems: 'center',
									gap: '0.6rem',
									padding: '0.75rem 1rem',
									border: `1px solid ${checked ? '#2563eb' : '#d1d5db'}`,
									borderRadius: 8,
									background: checked ? '#eff6ff' : '#fff',
									cursor: 'pointer',
								}}
							>
								<input
									type="radio"
									name={name}
									value={option.value}
									checked={checked}
									onChange={() => onChange(option.value)}
									onBlur={onBlur}
								/>
								<span>{option.label}</span>
							</label>
						)
					})}
				</div>
				{errors.length > 0 ? (
					<p id={errorId} role="alert" style={{ color: '#b91c1c', marginTop: '0.5rem' }}>
						{errors[0]}
					</p>
				) : null}
			</fieldset>
		)
	}
)
