'use client'

import { useId } from 'react'
import type { ConsentLink } from '../../consent/defineConsentSource'
import { defineFieldRenderer } from '../contract'
import { Checkbox } from '../primitives/Checkbox'
import { FieldShell } from '../primitives/FieldShell'

export const consentRenderer = defineFieldRenderer<boolean>(
	({ field, name, value, onChange, onBlur, errors, warnings, required, disabled }) => {
		const id = useId()
		const describedById = `${id}-desc`
		// The visible agreement text labels the checkbox. Prefer the explicit `statement`; fall back to the
		// field `label` so a consent field authored with only a label (or a blank statement) is never an
		// unlabelled control (a11y). A blank or whitespace-only value counts as absent.
		const text = (raw: unknown): string | undefined =>
			typeof raw === 'string' && raw.trim() !== '' ? raw : undefined
		const statement = text(field.statement) ?? text(field.label)

		const links: ConsentLink[] = Array.isArray(field.consentLinks)
			? (field.consentLinks as ConsentLink[])
			: (() => {
					const sc = field.sourceConfig as Record<string, unknown> | undefined
					if (sc && typeof sc.url === 'string' && sc.url) {
						return [{ label: typeof sc.label === 'string' ? sc.label : 'Policy', url: sc.url }]
					}
					return []
				})()

		return (
			<FieldShell
				id={id}
				label={statement}
				description={typeof field.description === 'string' ? field.description : undefined}
				required={required}
				errors={errors}
				warnings={warnings}
				describedById={describedById}
			>
				<Checkbox
					id={id}
					name={name}
					checked={value ?? false}
					onChange={onChange}
					onBlur={onBlur}
					required={required}
					disabled={disabled}
					invalid={errors.length > 0}
					describedById={describedById}
				/>
				{links.length > 0 ? (
					<span className="fb-consent__links">
						{links.map((link) => (
							<a
								key={link.url}
								href={link.url}
								target="_blank"
								rel="noopener noreferrer"
								className="fb-consent__link"
							>
								{link.label}
							</a>
						))}
					</span>
				) : null}
			</FieldShell>
		)
	}
)
