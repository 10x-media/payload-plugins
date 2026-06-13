'use client'

export type SelectOption = { label: string; value: string }

export type SelectProps = {
	id: string
	name: string
	value: string
	options: SelectOption[]
	onChange: (value: string) => void
	onBlur?: () => void
	required?: boolean
	disabled?: boolean
	invalid?: boolean
	describedById?: string
	placeholder?: string
}

export const Select = ({
	id,
	name,
	value,
	options,
	onChange,
	onBlur,
	required,
	disabled,
	invalid,
	describedById,
	placeholder,
}: SelectProps) => (
	<select
		id={id}
		name={name}
		className="fb-select"
		value={value}
		required={required}
		disabled={disabled}
		aria-invalid={invalid || undefined}
		aria-describedby={describedById}
		onChange={(event) => onChange(event.target.value)}
		onBlur={onBlur}
	>
		{placeholder !== undefined ? <option value="">{placeholder}</option> : null}
		{options.map((option) => (
			<option key={option.value} value={option.value}>
				{option.label}
			</option>
		))}
	</select>
)
