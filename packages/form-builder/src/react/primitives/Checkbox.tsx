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
		onChange={(e) => onChange(e.target.checked)}
		onBlur={onBlur}
	/>
)
