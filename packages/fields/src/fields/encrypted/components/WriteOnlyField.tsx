'use client'
import {
	FieldDescription,
	FieldError,
	FieldLabel,
	useDocumentEvents,
	useField,
	useFormFields,
	useFormSubmitted,
} from '@payloadcms/ui'
import { mergeFieldStyles } from '@payloadcms/ui/shared'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { keys } from '../../../translations/keys'
import { useTranslation } from '../../../translations/useTranslation'
import { generateSecret, type NormalizedGenerate } from '../generateSecret'
import { formatHint } from '../hint'
import { dotString } from './MaskDots'
import type { EncryptedFieldConfig, Placement } from './placement'
import { ActionButton } from './WriteOnlyActions'
import { applyBlur, applyClear, applyInput, applySave, applyUndo } from './writeOnlyIntent'

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

	// A successful save ends the reveal-once window: the staged plaintext (typed
	// or generated) is dropped and the field returns to its concealed face
	// immediately, not on the next page load. The edit view fires reportUpdate
	// only on success, so a failed save keeps the user's input. This write is
	// housekeeping, not an edit: disableModifyingForm keeps it from re-dirtying
	// the form Payload just marked clean, which would resurrect the
	// leave-without-saving warning on every navigation after a save.
	const { mostRecentUpdate } = useDocumentEvents()
	const lastUpdateAt = useRef(mostRecentUpdate?.updatedAt)
	useEffect(() => {
		if (!mostRecentUpdate?.updatedAt || mostRecentUpdate.updatedAt === lastUpdateAt.current) {
			return
		}
		lastUpdateAt.current = mostRecentUpdate.updatedAt
		const resolved = applySave()
		setValue(resolved.value, true)
		setCleared(resolved.cleared)
	}, [mostRecentUpdate?.updatedAt, setValue])

	const isNumber = componentKey === 'number'
	const typed = isNumber ? typeof value === 'number' : typeof value === 'string' && value !== ''

	const commit = useCallback(
		(outcome: { cleared: boolean; value: unknown }) => {
			setValue(outcome.value)
			setCleared(outcome.cleared)
		},
		[setValue]
	)

	const handleChange = useCallback(
		(event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
			commit(applyInput(event.target.value, { cleared, isNumber }))
		},
		[cleared, commit, isNumber]
	)

	const handleBlur = useCallback(() => {
		const outcome = applyBlur(value, { cleared, isNumber })
		if (outcome) {
			commit(outcome)
		}
	}, [cleared, commit, isNumber, value])

	const handleClear = useCallback(() => {
		const outcome = applyClear({ cleared, clearable, isSet, typed })
		if (outcome) {
			commit(outcome)
		}
	}, [cleared, clearable, commit, isSet, typed])

	const handleUndo = useCallback(() => {
		commit(applyUndo())
	}, [commit])

	const runGenerate = useCallback(async () => {
		if (!generate) return
		commit({ cleared: false, value: await generateSecret(generate) })
		// Select the fresh secret so the reveal-once window is one Cmd+C away.
		requestAnimationFrame(() => {
			inputRef.current?.focus()
			inputRef.current?.select?.()
		})
	}, [commit, generate])

	// Three unmistakable staged states: concealed face (text-colored hint/dots)
	// means keep, visible plaintext means replace, and the muted removal notice
	// means clear. Erasing typed text returns to whichever of the first and
	// last the user was in when they started typing.
	const placeholder = typed
		? undefined
		: cleared
			? t(keys.clearedOnSave)
			: !isSet
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
			{cleared && !typed ? (
				<ActionButton
					attached={placement === 'attached'}
					kind="undo"
					label={t(keys.undoClear)}
					onClick={handleUndo}
				/>
			) : showClear ? (
				<ActionButton
					attached={placement === 'attached'}
					kind="clear"
					label={t(keys.clearValue)}
					onClick={handleClear}
				/>
			) : null}
		</>
	)

	// A custom Field component short-circuits the path where Payload applies
	// admin.width and admin.style, so the field has to carry them itself.
	const styles = useMemo(() => mergeFieldStyles(field), [field])
	const isTextarea = componentKey === 'textarea'
	const inputProps = {
		autoComplete: 'off',
		className: [
			'tenx-protected-field__wo-input',
			!typed && isSet && !cleared && 'tenx-protected-field__wo-input--set',
		]
			.filter(Boolean)
			.join(' '),
		id: inputId,
		name: path,
		onBlur: handleBlur,
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
	const { setValue, value } = useField<unknown>({ path })
	const isSet = useFormFields(([fields]) => fields?.[setPath]?.value === true)
	const [mode, setMode] = useState<'cleared' | 'editing' | 'idle'>('idle')
	// The concealed face stands in for the native field, so it has to carry the
	// same width; without it the field would change width as the mode changes.
	const styles = useMemo(() => mergeFieldStyles(field), [field])

	// Mirror of the inline variant's save-conceal: a successful save drops any
	// staged edit and folds the field back to its concealed face, without
	// re-dirtying the form Payload just marked clean (disableModifyingForm).
	const { mostRecentUpdate } = useDocumentEvents()
	const lastUpdateAt = useRef(mostRecentUpdate?.updatedAt)
	useEffect(() => {
		if (!mostRecentUpdate?.updatedAt || mostRecentUpdate.updatedAt === lastUpdateAt.current) {
			return
		}
		lastUpdateAt.current = mostRecentUpdate.updatedAt
		setValue(undefined, true)
		setMode('idle')
	}, [mostRecentUpdate?.updatedAt, setValue])

	const toggleEdit = useCallback(() => {
		if (mode === 'editing') {
			// Discard only what was staged: cancelling an untouched editor must not
			// mark the form modified.
			if (value !== undefined) {
				setValue(undefined)
			}
			setMode('idle')
			return
		}
		setMode('editing')
	}, [mode, setValue, value])

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
				<div className="field-type tenx-protected-field__wo-face" style={styles}>
					<FieldLabel
						label={field.label}
						localized={field.localized}
						path={path}
						required={field.required}
					/>
					<div className="field-type__wrap">
						<FieldError path={path} />
						<div className="tenx-protected-field__wo-face-box">
							{mode === 'cleared' ? (
								<span className="tenx-protected-field__wo-face-msg">{t(keys.clearedOnSave)}</span>
							) : (
								<span
									aria-label={t(keys.writeOnlyValue)}
									className="tenx-protected-field__dots"
									role="img"
								>
									{dotString(maskDots)}
								</span>
							)}
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
