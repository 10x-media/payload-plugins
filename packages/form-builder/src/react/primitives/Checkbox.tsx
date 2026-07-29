'use client'

export type CheckboxProps = {
	id: string
	name: string
	checked: boolean
	onChange: (checked: boolean) => void
	onBlur?: () => void
	required?: boolean
	disabled?: boolean
	invalid?: boolean
	describedById?: string
	/** Overrides the accessible name (e.g. when the visible label is rich HTML with a plain-text equivalent). */
	ariaLabel?: string
	/** `switch` renders the same input as `role="switch"` styled as a toggle; omit for the plain checkbox. */
	variant?: 'checkbox' | 'switch'
}

export const Checkbox = ({
	id,
	name,
	checked,
	onChange,
	onBlur,
	required,
	disabled,
	invalid,
	describedById,
	ariaLabel,
	variant,
}: CheckboxProps) => (
	<input
		type="checkbox"
		role={variant === 'switch' ? 'switch' : undefined}
		className={variant === 'switch' ? 'fb-checkbox fb-switch' : 'fb-checkbox'}
		id={id}
		name={name}
		checked={checked}
		required={required}
		disabled={disabled}
		aria-invalid={invalid || undefined}
		aria-describedby={describedById}
		aria-label={ariaLabel}
		onChange={(e) => onChange(e.target.checked)}
		onBlur={onBlur}
	/>
)
