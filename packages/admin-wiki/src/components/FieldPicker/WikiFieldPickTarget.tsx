'use client'

import { CheckIcon } from '@payloadcms/ui'

import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { useWikiFieldPicker } from './WikiPickerContext'
import './field-picker.css'

export type WikiFieldPickTargetProps = {
	/**
	 * The field's owner-qualified schema path, exactly as the walker injected it:
	 * `collection:posts.title`, `block:heroBanner.heading`. This is the value the
	 * guide stores, so the plate needs no path construction of its own.
	 */
	schemaPath: string
}

/**
 * The affordance that replaces the help surface while a field is being picked: a
 * checkbox-shaped plate in the Description slot, which is the one place the
 * plugin already owns on every field it walked.
 *
 * Renders nothing outside a picker, so it is safe to drop into a custom field
 * component that wants the same behaviour as the injected description.
 */
export const WikiFieldPickTarget = ({ schemaPath }: WikiFieldPickTargetProps) => {
	const { t } = useTranslation()
	const picker = useWikiFieldPicker()

	if (!picker) {
		return null
	}

	const selected = picker.isSelected(schemaPath)

	return (
		<button
			aria-pressed={selected}
			className={['wiki-field-pick', selected && 'wiki-field-pick--selected']
				.filter(Boolean)
				.join(' ')}
			onClick={() => picker.toggle(schemaPath)}
			type="button"
		>
			<span aria-hidden="true" className="wiki-field-pick__box">
				{selected ? <CheckIcon /> : null}
			</span>
			<span className="wiki-field-pick__label">
				{selected ? t(keys.pickerSelected) : t(keys.pickerSelect)}
			</span>
		</button>
	)
}
