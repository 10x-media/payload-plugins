'use client'

import { defineFieldRenderer } from '@10x-media/form-builder/react'
import { useId } from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

type ConsentLink = { label: string; url: string }

export const consentField = defineFieldRenderer<boolean>(
	({ field, name, value, onChange, onBlur, errors, warnings, required, disabled }) => {
		const id = useId()
		const describedById = `${id}-desc`
		const invalid = errors.length > 0
		// The visible agreement text labels the checkbox. Prefer the explicit `statement`; fall back to
		// `label` so a consent field authored with only a label is never an unlabelled control (a11y).
		const text = (raw: unknown): string | undefined =>
			typeof raw === 'string' && raw.trim() !== '' ? raw : undefined
		const statement = text(field.statement) ?? text(field.label)
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
						className={cn('h-4 w-4 rounded border border-input', invalid && 'border-destructive')}
						onChange={(event) => onChange(event.target.checked)}
						onBlur={onBlur}
					/>
					{statement ? <Label htmlFor={id}>{statement}</Label> : null}
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
