'use client'

import { defineFieldRenderer, type RendererOption } from '@10x-media/form-builder/react'
import { useId } from 'react'

export const dateRenderer = defineFieldRenderer<string>(
	({ field, name, value, onChange, onBlur, errors, warnings, required, disabled }) => {
		const id = useId()
		const describedById = `${id}-desc`
		const invalid = errors.length > 0

		return (
			<div className="fb-field" data-invalid={invalid ? '' : undefined}>
				{typeof field.label === 'string' ? (
					<label htmlFor={id} className="fb-field__label">
						{field.label}
						{required ? (
							<span className="fb-field__required" aria-hidden>
								{' *'}
							</span>
						) : null}
					</label>
				) : null}
				<input
					id={id}
					name={name}
					type="date"
					className="fb-input"
					value={value ?? ''}
					required={required}
					disabled={disabled}
					aria-invalid={invalid || undefined}
					aria-describedby={describedById}
					placeholder={typeof field.placeholder === 'string' ? field.placeholder : undefined}
					onChange={(e) => onChange(e.target.value)}
					onBlur={onBlur}
				/>
				<div id={describedById} className="fb-field__messages">
					{typeof field.description === 'string' ? (
						<p className="fb-field__description">{field.description}</p>
					) : null}
					{errors.length > 0 ? (
						<div role="alert" aria-atomic className="fb-field__errors">
							{errors.map((msg) => (
								<p key={msg} className="fb-field__error">
									{msg}
								</p>
							))}
						</div>
					) : null}
					{warnings?.map((msg) => (
						<p key={msg} className="fb-field__warning">
							{msg}
						</p>
					))}
				</div>
			</div>
		)
	}
) as RendererOption
