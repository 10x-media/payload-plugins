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
}: CheckboxProps) => (
	<input
		type="checkbox"
		className="fb-checkbox"
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
