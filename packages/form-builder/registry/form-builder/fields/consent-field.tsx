'use client'

import { defineFieldRenderer, serializeBody, textOfBody } from '@10x-media/form-builder/react'
import { useId, useMemo } from 'react'
import { cn } from '@/lib/utils'

type ConsentLink = { label: string; url: string }

const text = (raw: unknown): string | undefined =>
	typeof raw === 'string' && raw.trim() !== '' ? raw : undefined

/**
 * HTML for a rich text (Lexical/legacy Slate) statement. A legacy plain string never goes through
 * this path: `serializeBody` interpolates a string body unescaped (its pre-richText behavior), so
 * rendering one as HTML would let literal markup in old data execute; a plain string renders as
 * text instead.
 */
const richStatementHtml = (statement: unknown): string | undefined => {
	if (typeof statement === 'string' || statement == null) {
		return undefined
	}
	const html = serializeBody(statement, { values: [], descriptors: [] })
	return html === '' ? undefined : html
}

export const consentField = defineFieldRenderer<boolean>(
	({ field, name, value, onChange, onBlur, errors, warnings, required, disabled }) => {
		const id = useId()
		const describedById = `${id}-desc`
		const invalid = errors.length > 0
		// The checkbox's accessible name is always plain text, regardless of the statement's shape
		// (rich text, legacy string, or absent). Prefer the explicit `statement`; fall back to
		// `label` so a consent field authored with only a label is never an unlabelled control (a11y).
		const statement = text(textOfBody(field.statement)) ?? text(field.label)
		const html = useMemo(() => richStatementHtml(field.statement), [field.statement])
		const description = typeof field.description === 'string' ? field.description : undefined

		const links: ConsentLink[] = Array.isArray(field.consentLinks)
			? (field.consentLinks as ConsentLink[])
			: (() => {
					const sourceConfig = field.sourceConfig as Record<string, unknown> | undefined
					if (sourceConfig && typeof sourceConfig.url === 'string' && sourceConfig.url) {
						return [
							{
								label: typeof sourceConfig.label === 'string' ? sourceConfig.label : 'Policy',
								url: sourceConfig.url,
							},
						]
					}
					return []
				})()

		return (
			<div className="grid gap-2">
				<div className="flex items-center gap-2">
					<input
						id={id}
						name={name}
						type="checkbox"
						checked={value ?? false}
						required={required}
						disabled={disabled}
						aria-invalid={invalid || undefined}
						aria-describedby={describedById}
						aria-label={statement}
						className={cn('h-4 w-4 rounded border border-input', invalid && 'border-destructive')}
						onChange={(event) => onChange(event.target.checked)}
						onBlur={onBlur}
					/>
					{html ? (
						// The statement is a plain sibling, never a <label>: a native <label> forwards clicks
						// to its control even for descendant links (they aren't "labelable" elements per the
						// HTML spec), so an inline link here would also silently toggle the checkbox. The
						// checkbox's name comes from aria-label instead. A <div>, because serializeBody emits
						// block elements (<p>, headings, lists) that are invalid inside inline wrappers.
						// Safe to inject: serializeBody HTML-escapes all text and sanitizes link URLs.
						<div
							className="text-sm"
							// biome-ignore lint/security/noDangerouslySetInnerHtml: HTML is produced by the package's escaping serializer, never raw user input
							dangerouslySetInnerHTML={{ __html: html }}
						/>
					) : statement ? (
						<span className="text-sm">{statement}</span>
					) : null}
				</div>
				{links.length > 0 ? (
					<span className="flex flex-wrap gap-3">
						{links.map((link) => (
							<a
								key={link.url}
								href={link.url}
								target="_blank"
								rel="noopener noreferrer"
								className="text-sm text-primary underline underline-offset-4"
							>
								{link.label}
							</a>
						))}
					</span>
				) : null}
				<div id={describedById} className="grid gap-1 text-sm">
					{description ? <p className="text-muted-foreground">{description}</p> : null}
					{invalid ? (
						<div aria-atomic className="text-destructive" role="alert">
							{errors.map((message) => (
								<p key={message}>{message}</p>
							))}
						</div>
					) : null}
					{warnings?.map((message) => (
						<p key={message} className="text-amber-600">
							{message}
						</p>
					))}
				</div>
			</div>
		)
	}
)
