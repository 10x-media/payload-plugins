'use client'
import {
	FieldDescription,
	FieldError,
	FieldLabel,
	InputStepper,
	useField,
	useFormFields,
	useFormSubmitted,
} from '@payloadcms/ui'
import { mergeFieldStyles } from '@payloadcms/ui/shared'
import type React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { EyeToggle } from './EyeToggle'
import { dotString } from './MaskDots'
import type { EncryptedFieldConfig } from './placement'

type InputKind = 'email' | 'number' | 'text'

interface EncryptedInputProps {
	field: EncryptedFieldConfig
	kind: InputKind
	maskDots: number
	path: string
	readOnly?: boolean
}

/**
 * Attached-placement field for single text, email, and number. One input is
 * mounted in both states and only morphs on toggle: a readOnly dots facsimile
 * while concealed, the bound editable input while revealed. Reusing the same
 * element means revealing never remounts the control and never shifts layout.
 * Concealed, the input is readOnly and its value is the dot run, so the decrypted
 * plaintext (already in form state from afterRead) never reaches the DOM and
 * masking cannot mutate form state; setValue only runs while revealed. The eye is
 * a sibling flex segment that stays put across toggles. Read-only still reveals
 * (that is reading), but the input is disabled, as on a native field.
 */
export const EncryptedInput: React.FC<EncryptedInputProps> = ({
	field,
	kind,
	maskDots,
	path,
	readOnly,
}) => {
	const [revealed, setRevealed] = useState(false)
	const { setValue, showError, value } = useField<number | string>({ path })
	const submitted = useFormSubmitted()
	const invalid = useFormFields(([fields]) => fields?.[path]?.valid === false)
	const showFieldError = submitted && invalid
	const toggle = useCallback(() => setRevealed((prev) => !prev), [])
	const inputId = `field-${path.replace(/\./g, '__')}`
	const isNumber = kind === 'number'

	const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		if (isNumber) {
			const parsed = Number.parseFloat(event.target.value)
			setValue(Number.isNaN(parsed) ? null : parsed)
			return
		}
		setValue(event.target.value)
	}

	// Native number fields carry Payload's stepper inside the input group; it
	// stays mounted while concealed (disabled) so revealing never shifts layout.
	const handleStep = (direction: 1 | -1) => {
		const current = typeof value === 'number' ? value : 0
		setValue(current + direction * (field.admin?.step ?? 1))
	}

	const revealedValue = isNumber
		? typeof value === 'number'
			? value
			: ''
		: typeof value === 'string'
			? value
			: ''

	// A custom Field component short-circuits the path where Payload applies
	// admin.width and admin.style, so the field has to carry them itself.
	const styles = useMemo(() => mergeFieldStyles(field), [field])

	return (
		<div
			className={[
				'field-type',
				kind,
				showFieldError && 'error',
				'tenx-protected-field',
				'tenx-protected-field--attached',
				readOnly && 'read-only',
			]
				.filter(Boolean)
				.join(' ')}
			style={styles}
		>
			<FieldLabel
				label={field.label}
				localized={field.localized}
				path={path}
				required={field.required}
			/>
			<div className="field-type__wrap">
				<FieldError path={path} />
				<div
					className={[
						'form-input-group',
						showFieldError && 'form-input-group-error',
						'tenx-protected-field__attached-row',
					]
						.filter(Boolean)
						.join(' ')}
				>
					<input
						aria-invalid={revealed ? showError : undefined}
						autoComplete={revealed && !isNumber ? field.admin?.autoComplete : undefined}
						className={[
							'form-input',
							revealed
								? 'tenx-protected-field__revealed-input'
								: 'tenx-protected-field__masked-input',
						].join(' ')}
						disabled={readOnly}
						id={inputId}
						inputMode={revealed && isNumber ? 'decimal' : undefined}
						name={path}
						onChange={revealed ? handleChange : undefined}
						placeholder={
							revealed && !isNumber && typeof field.admin?.placeholder === 'string'
								? field.admin.placeholder
								: undefined
						}
						readOnly={!revealed}
						step={revealed && isNumber ? field.admin?.step : undefined}
						tabIndex={revealed ? undefined : -1}
						type={revealed ? (isNumber ? 'number' : kind === 'email' ? 'email' : 'text') : 'text'}
						value={revealed ? revealedValue : dotString(maskDots)}
					/>
					{isNumber ? (
						<InputStepper
							disabled={!revealed || readOnly}
							onDecrement={() => handleStep(-1)}
							onIncrement={() => handleStep(1)}
						/>
					) : null}
					<div className="tenx-protected-field__eye-wrap tenx-protected-field__eye-wrap--attached">
						<EyeToggle
							className="tenx-protected-field__eye--attached"
							onToggle={toggle}
							revealed={revealed}
						/>
					</div>
				</div>
				<FieldDescription description={field.admin?.description} path={path} />
			</div>
		</div>
	)
}
