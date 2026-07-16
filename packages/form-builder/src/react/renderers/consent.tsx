'use client'

import { useId, useMemo } from 'react'
import { serializeBody } from '../../actions/body/serializeBody'
import { textOfBody } from '../../actions/body/textOfBody'
import type { ConsentLink } from '../../consent/defineConsentSource'
import { defineFieldRenderer } from '../contract'
import { Checkbox } from '../primitives/Checkbox'
import { FieldShell } from '../primitives/FieldShell'

const text = (raw: unknown): string | undefined =>
	typeof raw === 'string' && raw.trim() !== '' ? raw : undefined

/**
 * HTML for a rich text (Lexical/legacy Slate) statement. A legacy plain string never goes through
 * this path: `serializeBody` interpolates a string body unescaped (its pre-richText behavior), so
 * rendering one as HTML would let literal markup in old data execute; the renderer shows a plain
 * string as text instead.
 */
const richStatementHtml = (statement: unknown): string | undefined => {
	if (typeof statement === 'string' || statement == null) {
		return undefined
	}
	const html = serializeBody(statement, { values: [], descriptors: [] })
	return html === '' ? undefined : html
}

export const consentRenderer = defineFieldRenderer<boolean>(
	({ field, name, value, onChange, onBlur, errors, warnings, required, disabled }) => {
		const id = useId()
		const describedById = `${id}-desc`

		// The checkbox's accessible name is always plain text, regardless of the statement's shape
		// (rich text, legacy string, or absent), so it stays a single, unambiguous string even
		// though the visible statement can contain formatting and inline links.
		const plainStatement = text(textOfBody(field.statement)) ?? text(field.label)
		const html = useMemo(() => richStatementHtml(field.statement), [field.statement])

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
				description={typeof field.description === 'string' ? field.description : undefined}
				required={required}
				errors={errors}
				warnings={warnings}
				describedById={describedById}
			>
				{html ? (
					// The statement is a plain sibling, never a <label>: a native <label> forwards clicks to
					// its control even for descendant links (they aren't "labelable" elements per the HTML
					// spec), so an inline link here would also silently toggle the checkbox. The checkbox's
					// name comes from aria-label instead. A <div>, because serializeBody emits block
					// elements (<p>, headings, lists) that are invalid inside inline wrappers.
					// Safe to inject: serializeBody HTML-escapes all text and sanitizes link URLs.
					// biome-ignore lint/security/noDangerouslySetInnerHtml: HTML is produced by our escaping serializer, never raw user input
					<div className="fb-consent__statement" dangerouslySetInnerHTML={{ __html: html }} />
				) : plainStatement ? (
					<span className="fb-consent__statement">{plainStatement}</span>
				) : null}
				{required && (html || plainStatement) ? (
					<span className="fb-field__required" aria-hidden="true">
						{' *'}
					</span>
				) : null}
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
					ariaLabel={plainStatement}
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
