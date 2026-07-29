'use client'

import type { ReactNode } from 'react'

export type FieldShellProps = {
	/** The control id this shell labels and describes. */
	id: string
	label?: string
	description?: string
	required?: boolean
	errors?: string[]
	/** id used for aria-describedby on the control; the shell renders description + messages under it. */
	describedById: string
	/**
	 * When true, the caption renders as a plain `<span>` instead of a `<label htmlFor>`: for a control
	 * with no single element to bind to (a native radiogroup), `htmlFor` pointing at a nonexistent id is
	 * a dead click and invalid HTML. The caption still carries `id={`${id}-label`}` either way, so the
	 * child wires `aria-labelledby={`${id}-label`}` itself.
	 */
	group?: boolean
	children: ReactNode
}

/**
 * Accessible wrapper for a single field: a caption bound to the control, the control slot, an optional
 * description, and error messages. The control inside must set `aria-describedby={describedById}`
 * and `aria-invalid` when errors exist; this shell renders the matching `id={describedById}` region.
 * The caption carries `id={`${id}-label`}`, so a control with no single element to `htmlFor` (see
 * `group`) can still name itself via `aria-labelledby`.
 */
export const FieldShell = ({
	id,
	label,
	description,
	required,
	errors = [],
	describedById,
	group = false,
	children,
}: FieldShellProps) => {
	const requiredMark = required ? (
		<span className="fb-field__required" aria-hidden="true">
			{' *'}
		</span>
	) : null

	return (
		<div className="fb-field" data-invalid={errors.length > 0 ? '' : undefined}>
			{label ? (
				group ? (
					<span className="fb-field__label" id={`${id}-label`}>
						{label}
						{requiredMark}
					</span>
				) : (
					<label className="fb-field__label" htmlFor={id} id={`${id}-label`}>
						{label}
						{requiredMark}
					</label>
				)
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
			</div>
		</div>
	)
}
