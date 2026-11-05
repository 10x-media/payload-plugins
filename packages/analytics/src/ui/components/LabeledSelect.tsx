'use client'

import { ChevronIcon, FieldLabel, ReactSelect, type ReactSelectOption } from '@payloadcms/ui'
import { type ComponentPropsWithRef, type CSSProperties, useId } from 'react'
import { classNames } from '../classNames'
import '../analytics.css'

/**
 * Payload's select chevron, kept out of the tab order: react-select hides it from assistive
 * tech, and a focusable button inside `aria-hidden` is a stop announced as nothing.
 */
const DropdownIndicator = ({ innerProps }: { innerProps: ComponentPropsWithRef<'button'> }) => (
	<button {...innerProps} className="dropdown-indicator" tabIndex={-1} type="button">
		<ChevronIcon className="dropdown-indicator__icon" />
	</button>
)

/** Components for a `ReactSelect` drawn outside `LabeledSelect`, with the same unfocusable chevron. */
export const selectComponents = { DropdownIndicator }

export interface LabeledSelectOption<V extends string> {
	value: V
	label: string
}

export interface LabeledSelectProps<V extends string> {
	label: string
	options: ReadonlyArray<LabeledSelectOption<V>>
	/** Shows no choice when it matches no option. */
	value: V | undefined
	onChange: (value: V) => void
	readOnly?: boolean
	/** Hooks on the wrapper beside Payload's `field-type select`. */
	className?: string
	/** A field's own admin style and width, as Payload's `mergeFieldStyles` gives them. */
	style?: CSSProperties
}

/**
 * A select named by its label, pointed at the `ReactSelect` input itself: Payload's `SelectInput`
 * labels the wrapper and leaves the combobox unnamed. Answers only values among `options`.
 */
export function LabeledSelect<V extends string>({
	label,
	options,
	value,
	onChange,
	readOnly = false,
	className,
	style,
}: LabeledSelectProps<V>) {
	const inputId = useId()
	const selected = options.find((option) => option.value === value)
	const pick = (picked: ReactSelectOption | ReactSelectOption[]): void => {
		const one = Array.isArray(picked) ? picked[0] : picked
		const match = options.find((option) => option.value === one?.value)
		if (match !== undefined) {
			onChange(match.value)
		}
	}
	return (
		<div
			className={classNames(
				'field-type',
				'select',
				'analytics-select',
				className,
				readOnly && 'read-only'
			)}
			{...(style === undefined ? {} : { style })}
		>
			<FieldLabel htmlFor={inputId} label={label} />
			<div className="field-type__wrap">
				<ReactSelect
					components={selectComponents}
					disabled={readOnly}
					inputId={inputId}
					isClearable={false}
					onChange={pick}
					options={options.map((option) => ({ value: option.value, label: option.label }))}
					{...(selected === undefined
						? {}
						: { value: { value: selected.value, label: selected.label } })}
				/>
			</div>
		</div>
	)
}
