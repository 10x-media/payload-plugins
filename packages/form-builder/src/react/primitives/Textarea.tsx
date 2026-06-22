'use client'

export type TextareaProps = {
	id: string
	name: string
	value: string
	onChange: (value: string) => void
	onBlur?: () => void
	placeholder?: string
	required?: boolean
	disabled?: boolean
	invalid?: boolean
	describedById?: string
}

export const Textarea = ({
	id,
	name,
	value,
	onChange,
	onBlur,
	placeholder,
	required,
	disabled,
	invalid,
	describedById,
}: TextareaProps) => (
	<textarea
		id={id}
		name={name}
		className="fb-textarea"
		value={value}
		placeholder={placeholder}
		required={required}
		disabled={disabled}
		aria-invalid={invalid || undefined}
		aria-describedby={describedById}
		onChange={(e) => onChange(e.target.value)}
		onBlur={onBlur}
	/>
)
