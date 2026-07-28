'use client'

export type ChoiceOption = { label: string; value: string }

export type ChoiceGroupProps = {
	name: string
	value: string
	options: ChoiceOption[]
	onChange: (value: string) => void
	onBlur?: () => void
	required?: boolean
	disabled?: boolean
	invalid?: boolean
	describedById?: string
	/** id of the element that names the group (`aria-labelledby`); omit when the field has no label. */
	labelledById?: string
	/** `radio` is the plain native list; `buttons` is the same semantics styled as a segmented control. */
	variant: 'radio' | 'buttons'
}

/**
 * A native `role="radiogroup"` of radio inputs backing a single-select field: the `radio` and
 * `buttons` display variants of the select field type. `aria-invalid` sits on each radio input, not
 * the group `div` (a `div` can't take focus), so the terminal-submit focus routing
 * (`[aria-invalid="true"]`) can land on it same as any other control.
 */
export const ChoiceGroup = ({
	name,
	value,
	options,
	onChange,
	onBlur,
	required,
	disabled,
	invalid,
	describedById,
	labelledById,
	variant,
}: ChoiceGroupProps) => (
	<div
		role="radiogroup"
		aria-labelledby={labelledById}
		aria-describedby={describedById}
		className={variant === 'buttons' ? 'fb-choice fb-choice--buttons' : 'fb-choice'}
	>
		{options.map((option) => (
			<label key={option.value} className="fb-choice__option">
				<input
					type="radio"
					name={name}
					value={option.value}
					checked={value === option.value}
					onChange={() => onChange(option.value)}
					onBlur={onBlur}
					required={required}
					disabled={disabled}
					aria-invalid={invalid || undefined}
				/>
				<span>{option.label}</span>
			</label>
		))}
	</div>
)
