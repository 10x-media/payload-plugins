'use client'

import { useId, useMemo } from 'react'
import { sanitizeUrl } from '../../actions/body/converters'
import { serializeBody } from '../../actions/body/serializeBody'
import { textOfBody } from '../../actions/body/textOfBody'
import { defineFieldRenderer } from '../contract'
import { Checkbox } from '../primitives/Checkbox'
import { FieldShell } from '../primitives/FieldShell'

type ConsentLink = { label: string; url: string }

const text = (raw: unknown): string | undefined =>
	typeof raw === 'string' && raw.trim() !== '' ? raw : undefined

/**
 * HTML for a rich text statement. A plain string never goes through this path: `serializeBody`
 * interpolates a string body unescaped (its pre-richText behavior), so rendering one as HTML would
 * let literal markup execute; the renderer shows a plain string as text instead.
 */
const richStatementHtml = (statement: unknown): string | undefined => {
	if (typeof statement === 'string' || statement == null) {
		return undefined
	}
	const html = serializeBody(statement, { values: [], descriptors: [] })
	return html === '' ? undefined : html
}

/**
 * The resolved policy link, or nothing unless the source carries both a url and a name to show
 * for it: an anchor labelled by a raw URL or a machine key is worse than no anchor. The href is
 * sanitized like every other url the package renders, since a source is admin-authored and can
 * point anywhere (`sanitizeUrl` keeps http(s)/mailto/tel and relative urls, and neutralizes the
 * rest to `#`).
 */
const linkOf = (raw: unknown): ConsentLink | undefined => {
	const link = raw as Partial<ConsentLink> | undefined
	const label = text(link?.label)
	return label && typeof link?.url === 'string' && link.url !== ''
		? { label, url: sanitizeUrl(link.url) }
		: undefined
}

/**
 * The `statement` and `link` this reads are server-resolved from the field's consent source and
 * injected by `toFormDocument(doc, { consentStatements })`; the form document itself carries only
 * the source key, so a form rendered without that step shows no statement rather than a stale one.
 */
export const consentRenderer = defineFieldRenderer<boolean>(
	({ field, name, value, onChange, onBlur, errors, warnings, required, disabled }) => {
		const id = useId()
		const describedById = `${id}-desc`

		// The checkbox's accessible name is always plain text, regardless of the statement's shape,
		// so it stays a single unambiguous string even though the visible statement can carry
		// formatting and inline links. With no statement resolved the field is misconfigured; the
		// machine name still beats leaving the control unnamed.
		const plainStatement = text(textOfBody(field.statement))
		const html = useMemo(() => richStatementHtml(field.statement), [field.statement])
		const link = linkOf(field.link)

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
					ariaLabel={plainStatement ?? name}
				/>
				{link ? (
					<span className="fb-consent__links">
						<a
							href={link.url}
							target="_blank"
							rel="noopener noreferrer"
							className="fb-consent__link"
						>
							{link.label}
						</a>
					</span>
				) : null}
			</FieldShell>
		)
	}
)
