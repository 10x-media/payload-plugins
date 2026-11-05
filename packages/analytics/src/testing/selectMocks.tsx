import type { ChangeEvent } from 'react'

interface MockOption {
	value: unknown
	label?: unknown
}

/**
 * Stand-ins for `LabeledSelect`'s Payload pieces in tests that mock `@payloadcms/ui`: a native
 * select labelled for its `inputId`, so a test finds it by name as a reader would.
 */
export const selectMocks = {
	ChevronIcon: () => null,
	FieldLabel: ({ htmlFor, label }: { htmlFor?: string; label?: unknown }) => (
		<label htmlFor={htmlFor}>{String(label ?? '')}</label>
	),
	ReactSelect: ({
		inputId,
		options,
		value,
		onChange,
		disabled,
	}: {
		inputId?: string
		options: MockOption[]
		value?: MockOption
		onChange?: (option: MockOption) => void
		disabled?: boolean
	}) => (
		<select
			disabled={disabled}
			id={inputId}
			onChange={(event: ChangeEvent<HTMLSelectElement>) => {
				const picked = options.find((option) => String(option.value) === event.target.value)
				if (picked) {
					onChange?.(picked)
				}
			}}
			value={value === undefined ? '' : String(value.value)}
		>
			{value === undefined ? <option value="" /> : null}
			{options.map((option) => (
				<option key={String(option.value)} value={String(option.value)}>
					{String(option.label ?? option.value)}
				</option>
			))}
		</select>
	),
}
