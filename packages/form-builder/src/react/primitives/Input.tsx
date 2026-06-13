'use client'

export type InputProps = {
	id: string
	name: string
	type?: 'text' | 'email' | 'number'
	value: string
	onChange: (value: string) => void
	onBlur?: () => void
	placeholder?: string
	required?: boolean
	disabled?: boolean
	invalid?: boolean
	describedById?: string
}

export const Input = ({
	id,
	name,
	type = 'text',
	value,
	onChange,
	onBlur,
	placeholder,
	required,
	disabled,
	invalid,
	describedById,
}: InputProps) => (
	<input
		id={id}
		name={name}
		type={type}
		className="fb-input"
		value={value}
		placeholder={placeholder}
		required={required}
		disabled={disabled}
		aria-invalid={invalid || undefined}
		aria-describedby={describedById}
		onChange={(event) => onChange(event.target.value)}
		onBlur={onBlur}
	/>
)
