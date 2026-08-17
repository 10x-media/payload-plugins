'use client'
import { Button, FieldDescription, FieldLabel, Pill, useField, useFormFields } from '@payloadcms/ui'
import type React from 'react'
import { useCallback, useState } from 'react'
import { keys } from '../../../translations/keys'
import { useTranslation } from '../../../translations/useTranslation'
import { dotString } from './MaskDots'
import type { EncryptedFieldConfig } from './placement'

type NativeComponent = React.ComponentType<Record<string, unknown>>

type Mode = 'cleared' | 'editing' | 'idle'

/**
 * Editor for `protection: 'writeOnly'`. The plaintext never reaches the client
 * (reads strip the field), so there is no reveal: the form value starts absent,
 * and set-ness comes from the virtual `_set` sibling. Unset renders the plain
 * native control. Set renders a dots facsimile with Replace (swap to an empty
 * native control; Cancel restores) and Clear (submits an explicit null, with
 * Undo). An untouched field submits nothing, preserving the stored secret.
 */
export const WriteOnlyField: React.FC<{
	componentKey: string
	field: EncryptedFieldConfig
	maskDots: number
	Native: NativeComponent
	nativeProps: Record<string, unknown>
	path: string
	setPath: string
}> = ({ componentKey, field, maskDots, Native, nativeProps, path, setPath }) => {
	const { t } = useTranslation()
	const { setValue } = useField<unknown>({ path })
	const isSet = useFormFields(([fields]) => fields?.[setPath]?.value === true)
	const [mode, setMode] = useState<Mode>('idle')

	const beginReplace = useCallback(() => setMode('editing'), [])
	const cancelReplace = useCallback(() => {
		setValue(undefined)
		setMode('idle')
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

	if (mode === 'editing') {
		return (
			<div className="tenx-protected-field tenx-protected-field--write-only">
				<Native {...nativeProps} />
				<div className="tenx-protected-field__wo-actions">
					<Button buttonStyle="pill" margin={false} onClick={cancelReplace} size="small">
						{t(keys.cancelReplace)}
					</Button>
				</div>
			</div>
		)
	}

	const cleared = mode === 'cleared'
	return (
		<div
			className={[
				'field-type',
				componentKey,
				'tenx-protected-field',
				'tenx-protected-field--write-only',
			].join(' ')}
		>
			<FieldLabel
				label={field.label}
				localized={field.localized}
				path={path}
				required={field.required}
			/>
			<div className="field-type__wrap">
				<div className="tenx-protected-field__wo-row">
					<input
						aria-label={t(keys.writeOnlyValue)}
						className="tenx-protected-field__masked-input tenx-protected-field__wo-input"
						readOnly
						tabIndex={-1}
						type="text"
						value={cleared ? '' : dotString(maskDots)}
					/>
					<Pill pillStyle={cleared ? 'warning' : 'light-gray'} size="small">
						{cleared ? t(keys.clearedOnSave) : t(keys.secretSet)}
					</Pill>
				</div>
				<div className="tenx-protected-field__wo-actions">
					{cleared ? (
						<Button buttonStyle="pill" margin={false} onClick={undoClear} size="small">
							{t(keys.undoClear)}
						</Button>
					) : (
						<>
							<Button buttonStyle="pill" margin={false} onClick={beginReplace} size="small">
								{t(keys.replaceValue)}
							</Button>
							<Button buttonStyle="pill" margin={false} onClick={clear} size="small">
								{t(keys.clearValue)}
							</Button>
						</>
					)}
				</div>
				<FieldDescription description={field.admin?.description} path={path} />
			</div>
		</div>
	)
}
