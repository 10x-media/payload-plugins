'use client'
import {
	CheckboxField,
	CodeField,
	DateTimeField,
	EmailField,
	JSONField,
	NumberField,
	PointField,
	RadioGroupField,
	SelectField,
	TextareaField,
	TextField,
	useFormFields,
} from '@payloadcms/ui'
import type { TextFieldClientProps } from 'payload'
import type React from 'react'
import { useMemo, useState } from 'react'
import { clampMaskDots } from '../maskDots'
import type { EncryptedFieldPatch, EncryptedProtection } from '../types'
import { EncryptedInput } from './EncryptedInput'
import { EncryptedTextarea } from './EncryptedTextarea'
import type { EncryptedFieldConfig } from './placement'
import { placementFor } from './placement'
import { StructuralField } from './StructuralField'
import { WriteOnlyField } from './WriteOnlyField'
import './ProtectedField.css'

/**
 * Native components accept per-type client props; dispatch is by runtime
 * componentKey, so the map is typed at the erased component boundary.
 */
type AnyFieldComponent = React.ComponentType<Record<string, unknown>>

const NATIVE: Record<string, AnyFieldComponent> = {
	checkbox: CheckboxField as AnyFieldComponent,
	code: CodeField as AnyFieldComponent,
	date: DateTimeField as AnyFieldComponent,
	email: EmailField as AnyFieldComponent,
	json: JSONField as AnyFieldComponent,
	number: NumberField as AnyFieldComponent,
	point: PointField as AnyFieldComponent,
	radio: RadioGroupField as AnyFieldComponent,
	select: SelectField as AnyFieldComponent,
	text: TextField as AnyFieldComponent,
	textarea: TextareaField as AnyFieldComponent,
}

export interface ProtectedFieldProps extends TextFieldClientProps {
	componentKey: string
	fieldPatch: EncryptedFieldPatch
	maskDots?: number
	protection: EncryptedProtection
}

/**
 * A field with no stored content has nothing to conceal, so it renders unmasked
 * (the plain native control). Captured once at mount, so characters typed into a
 * field that started empty stay visible and the field never flips to masked
 * mid-entry; a field that already holds content is masked until revealed.
 */
const isEmptyValue = (value: unknown): boolean => {
	if (value == null || value === '') {
		return true
	}
	if (Array.isArray(value)) {
		return value.length === 0 || value.every((item) => item == null)
	}
	return false
}

/**
 * Single admin dispatcher for scalar and structural encrypted fields (richText
 * is its own virtual-editor field pair, wired to ProtectedRichText). Each type
 * renders as its native variant with a fixed run of dots while concealed, and an
 * inline eye toggle that swaps to the real editable native component on reveal.
 * The fieldPatch restores type-specific config (options, hasMany, date admin) on
 * the revealed component.
 *
 * Masking is visual-only by design. afterRead decrypts server-side, so the
 * field's form value is already plaintext regardless of the mask, and no masked
 * facsimile binds to that value. Two accepted consequences: (a) the plaintext
 * reaches an authorized admin's browser, since that admin already has field read
 * access and masking only stops casual over-the-shoulder display; (b) saving an
 * unchanged document re-seals with a fresh IV (version churn), because the form
 * holds plaintext, not the stored ciphertext.
 */
export const ProtectedField: React.FC<ProtectedFieldProps> = (props) => {
	const { componentKey, field, fieldPatch, path, protection } = props
	const maskDots = clampMaskDots(props.maskDots)
	const startedEmptyNow = useFormFields(([fields]) => isEmptyValue(fields?.[path]?.value))
	const [startedEmpty] = useState(startedEmptyNow)

	const patchedField = useMemo(
		() => ({
			...field,
			...fieldPatch,
			admin: { ...field.admin, ...fieldPatch.admin },
		}),
		[field, fieldPatch]
	)

	const Native = NATIVE[componentKey] ?? (TextField as AnyFieldComponent)
	const nativeProps = { ...(props as unknown as Record<string, unknown>), field: patchedField }

	if (protection === 'writeOnly') {
		return (
			<WriteOnlyField
				componentKey={componentKey}
				field={patchedField as unknown as EncryptedFieldConfig}
				maskDots={maskDots}
				Native={Native}
				nativeProps={nativeProps}
				path={path}
				setPath={`${path}_set`}
			/>
		)
	}

	if (protection === 'none' || startedEmpty) {
		return <Native {...nativeProps} />
	}

	const faceField = patchedField as unknown as EncryptedFieldConfig
	const hasMany = fieldPatch.hasMany === true
	const placement = placementFor(componentKey, hasMany)

	if (placement === 'attached') {
		return (
			<EncryptedInput
				field={faceField}
				kind={componentKey as 'email' | 'number' | 'text'}
				maskDots={maskDots}
				path={path}
			/>
		)
	}

	if (placement === 'corner') {
		return <EncryptedTextarea field={faceField} maskDots={maskDots} path={path} />
	}

	return (
		<StructuralField
			componentKey={componentKey}
			field={faceField}
			maskDots={maskDots}
			Native={Native}
			nativeProps={nativeProps}
			path={path}
		/>
	)
}
