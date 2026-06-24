'use client'

import type { ReactNode } from 'react'

export type FieldShellProps = {
	/** The control id this shell labels and describes. */
	id: string
	label?: string
	description?: string
	required?: boolean
	errors?: string[]
	warnings?: string[]
	/** id used for aria-describedby on the control; the shell renders description + messages under it. */
	describedById: string
	children: ReactNode
}

/**
 * Accessible wrapper for a single field: a `<label>` bound to the control, the control slot, an optional
 * description, and error/warning messages. The control inside must set `aria-describedby={describedById}`
 * and `aria-invalid` when errors exist; this shell renders the matching `id={describedById}` region.
 */
export const FieldShell = ({
	id,
	label,
	description,
	required,
	errors = [],
	warnings = [],
	describedById,
	children,
}: FieldShellProps) => (
	<div className="fb-field" data-invalid={errors.length > 0 ? '' : undefined}>
		{label ? (
			<label className="fb-field__label" htmlFor={id}>
				{label}
				{required ? (
					<span className="fb-field__required" aria-hidden="true">
						{' *'}
					</span>
				) : null}
			</label>
		) : null}
		{children}
		<div id={describedById} className="fb-field__messages">
			{description ? <p className="fb-field__description">{description}</p> : null}
			{errors.length > 0 ? (
				<div role="alert" aria-atomic="true" className="fb-field__errors">
					{errors.map((message) => (
						<p key={message} className="fb-field__error">
							{message}
						</p>
					))}
				</div>
			) : null}
			{warnings.map((message) => (
				<p key={message} className="fb-field__warning">
					{message}
				</p>
			))}
		</div>
	</div>
)
