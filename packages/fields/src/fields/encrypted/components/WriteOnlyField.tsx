'use client'
import {
	FieldDescription,
	FieldError,
	FieldLabel,
	useField,
	useFormFields,
	useFormSubmitted,
} from '@payloadcms/ui'
import type React from 'react'
import { useCallback, useRef, useState } from 'react'
import { keys } from '../../../translations/keys'
import { useTranslation } from '../../../translations/useTranslation'
import { generateSecret, type NormalizedGenerate } from '../generateSecret'
import { formatHint } from '../hint'
import { dotString } from './MaskDots'
import type { EncryptedFieldConfig, Placement } from './placement'
import { ActionButton } from './WriteOnlyActions'

type NativeComponent = React.ComponentType<Record<string, unknown>>

export interface WriteOnlyFieldProps {
	clearable: boolean
	componentKey: string
	field: EncryptedFieldConfig
	generate?: NormalizedGenerate
	hintPath: string
	maskDots: number
	Native: NativeComponent
	nativeProps: Record<string, unknown>
	path: string
	placement: Placement
	setPath: string
}

/**
 * Editor for `protection: 'writeOnly'`. The plaintext never reaches the client
 * (reads strip the field), so there is nothing to reveal and nothing to bind:
 * the control is one always-editable input. A stored value shows as a
 * placeholder (the identification hint when configured, dots otherwise), typing
 * stages a replacement that stays visible until save (the reveal-once window
 * for generated secrets), and emptying the input reverts to keeping the stored
 * value. Clear is the isClearable × inside the input; an undo arrow follows a
 * clear because the cleared secret cannot be retyped from memory. Every action
 * lives inside the input row (or the label row for structural types), so the
 * field never grows past its native height.
 */
export const WriteOnlyField: React.FC<WriteOnlyFieldProps> = (props) => {
	if (props.placement === 'label-row') {
		return <StructuralWriteOnly {...props} />
	}
	return <InlineWriteOnly {...props} />
}

const InlineWriteOnly: React.FC<WriteOnlyFieldProps> = ({
	clearable,
	componentKey,
	field,
	generate,
	hintPath,
	maskDots,
	path,
	placement,
	setPath,
}) => {
	const { t } = useTranslation()
	const { setValue, value } = useField<unknown>({ path })
	const isSet = useFormFields(([fields]) => fields?.[setPath]?.value === true)
	const hint = useFormFields(([fields]) => {
		const stored = fields?.[hintPath]?.value
		return typeof stored === 'string' && stored.length > 0 ? stored : undefined
	})
	const submitted = useFormSubmitted()
	const invalid = useFormFields(([fields]) => fields?.[path]?.valid === false)
	const showFieldError = submitted && invalid
	const [cleared, setCleared] = useState(false)
	const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)

	const isNumber = componentKey === 'number'
	const typed = isNumber ? typeof value === 'number' : typeof value === 'string' && value !== ''

	const handleChange = useCallback(
		(event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
			const text = event.target.value
			if (text === '') {
				// Emptied input keeps the stored value; the × is how you clear it.
				setValue(undefined)
				setCleared(false)
				return
			}
			setCleared(false)
			if (isNumber) {
				const parsed = Number.parseFloat(text)
				setValue(Number.isNaN(parsed) ? undefined : parsed)
				return
			}
			setValue(text)
		},
		[isNumber, setValue]
	)

	const discardOrClear = useCallback(() => {
		// One ×, clearing what is "in" the control: staged text first, then the
		// stored value (which flips into the undoable cleared state).
		if (typed) {
			setValue(undefined)
			return
		}
		setValue(null)
		setCleared(true)
	}, [typed, setValue])

	const undoClear = useCallback(() => {
		setValue(undefined)
		setCleared(false)
	}, [setValue])

	const runGenerate = useCallback(async () => {
		if (!generate) return
		setValue(await generateSecret(generate))
		setCleared(false)
		// Select the fresh secret so the reveal-once window is one Cmd+C away.
		requestAnimationFrame(() => {
			inputRef.current?.focus()
			inputRef.current?.select?.()
		})
	}, [generate, setValue])

	const placeholder = typed
		? undefined
		: cleared || !isSet
			? typeof field.admin?.placeholder === 'string'
				? field.admin.placeholder
				: undefined
			: hint
				? formatHint(hint, maskDots)
				: dotString(maskDots)

	const showClear = typed || (clearable && isSet && !cleared)
	const inputId = `field-${path.replace(/\./g, '__')}`
	const displayValue = typed ? String(value) : ''

	const actions = (
		<>
			{generate ? (
				<ActionButton
					attached={placement === 'attached'}
					kind="generate"
					label={t(keys.generateValue)}
					onClick={runGenerate}
				/>
			) : null}
			{cleared ? (
				<ActionButton
					attached={placement === 'attached'}
					kind="undo"
					label={t(keys.undoClear)}
					onClick={undoClear}
				/>
			) : showClear ? (
				<ActionButton
					attached={placement === 'attached'}
					kind="clear"
					label={t(keys.clearValue)}
					onClick={discardOrClear}
				/>
			) : null}
		</>
	)

	const isTextarea = componentKey === 'textarea'
	const inputProps = {
		autoComplete: 'off',
		className: 'tenx-protected-field__wo-input',
		id: inputId,
		name: path,
		onChange: handleChange,
		placeholder,
		value: displayValue,
	}

	return (
		<div
			className={[
				'field-type',
				componentKey,
				showFieldError && 'error',
				'tenx-protected-field',
				placement === 'attached'
					? 'tenx-protected-field--attached'
					: 'tenx-protected-field--corner',
			]
				.filter(Boolean)
				.join(' ')}
		>
			<FieldLabel
				label={field.label}
				localized={field.localized}
				path={path}
				required={field.required}
			/>
			<div className="field-type__wrap">
				<FieldError path={path} />
				{isTextarea ? (
					<>
						<textarea
							{...inputProps}
							ref={(el) => {
								inputRef.current = el
							}}
							rows={field.admin?.rows ?? 4}
						/>
						<div className="tenx-protected-field__eye-wrap tenx-protected-field__eye-wrap--corner tenx-protected-field__actions--corner">
							{actions}
						</div>
					</>
				) : (
					<div className="tenx-protected-field__attached-row">
						<input
							{...inputProps}
							ref={(el) => {
								inputRef.current = el
							}}
							inputMode={isNumber ? 'decimal' : undefined}
							type={isNumber ? 'number' : componentKey === 'email' && typed ? 'email' : 'text'}
						/>
						<div className="tenx-protected-field__eye-wrap tenx-protected-field__eye-wrap--attached">
							{actions}
						</div>
					</div>
				)}
				<FieldDescription description={field.admin?.description} path={path} />
			</div>
		</div>
	)
}

/**
 * Label-row variant for structural types (date, select, checkbox, code, json,
 * point, radio, and any hasMany surface): these have no single-line input to
 * type into, so replace goes through a pencil that mounts the real native
 * editor, with clear and undo beside it on the label line, exactly where the
 * masked eye sits.
 */
const StructuralWriteOnly: React.FC<WriteOnlyFieldProps> = ({
	clearable,
	field,
	maskDots,
	Native,
	nativeProps,
	path,
	setPath,
}) => {
	const { t } = useTranslation()
	const { setValue } = useField<unknown>({ path })
	const isSet = useFormFields(([fields]) => fields?.[setPath]?.value === true)
	const [mode, setMode] = useState<'cleared' | 'editing' | 'idle'>('idle')

	const toggleEdit = useCallback(() => {
		setMode((prev) => {
			if (prev === 'editing') {
				setValue(undefined)
				return 'idle'
			}
			return 'editing'
		})
	}, [setValue])

	const clear = useCallback(() => {
		setValue(null)
		setMode('cleared')
	}, [setValue])

	const undoClear = useCallback(() => {
		setValue(undefined)
		setMode('idle')
	}, [setValue])

	if (!isSet) {
		return <Native {...nativeProps} />
	}

	return (
		<div className="tenx-protected-field tenx-protected-field--label-row">
			{mode === 'editing' ? (
				<Native {...nativeProps} />
			) : (
				<div className="field-type tenx-protected-field__wo-face">
					<FieldLabel
						label={field.label}
						localized={field.localized}
						path={path}
						required={field.required}
					/>
					<div className="field-type__wrap">
						<FieldError path={path} />
						<div className="tenx-protected-field__wo-face-box">
							<span
								aria-label={t(keys.writeOnlyValue)}
								className="tenx-protected-field__dots"
								role="img"
							>
								{mode === 'cleared' ? '—' : dotString(maskDots)}
							</span>
						</div>
						<FieldDescription description={field.admin?.description} path={path} />
					</div>
				</div>
			)}
			<div className="tenx-protected-field__eye-wrap tenx-protected-field__eye-wrap--label-row">
				{mode === 'cleared' ? (
					<ActionButton kind="undo" label={t(keys.undoClear)} onClick={undoClear} />
				) : (
					<>
						<ActionButton
							kind="edit"
							label={t(keys.replaceValue)}
							onClick={toggleEdit}
							pressed={mode === 'editing'}
						/>
						{clearable && mode !== 'editing' ? (
							<ActionButton kind="clear" label={t(keys.clearValue)} onClick={clear} />
						) : null}
					</>
				)}
			</div>
		</div>
	)
}
