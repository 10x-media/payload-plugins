'use client'
import {
	Button,
	CheckboxField,
	CodeField,
	DateTimeField,
	EmailField,
	FieldLabel,
	JSONField,
	NumberField,
	PointField,
	RadioGroupField,
	SelectField,
	TextareaField,
	TextField,
	useField,
} from '@payloadcms/ui'
import type { StaticLabel, TextFieldClientProps } from 'payload'
import type React from 'react'
import { useMemo, useState } from 'react'
import { keys } from '../../../translations/keys'
import { useTranslation } from '../../../translations/useTranslation'
import type { EncryptedFieldPatch, EncryptedProtection } from '../types'
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
	protection: EncryptedProtection
}

/**
 * Concealed display: a static mask plus a reveal toggle. Deliberately does NOT
 * call useField or bind to the field value. afterRead already placed plaintext
 * in form state; a concealed submit must resubmit that untouched plaintext. If
 * the mask string ever entered form state, the seal hook (guarded only by
 * isSealed) would seal the placeholder as the secret. The mask stays a
 * display-only span.
 */
const MaskRow: React.FC<{
	label: StaticLabel | undefined
	onReveal: () => void
	path: string
	required?: boolean
}> = ({ label, onReveal, path, required }) => {
	const { t } = useTranslation()
	return (
		<div className="field-type tenx-protected-field">
			<FieldLabel label={label} path={path} required={required} />
			<div className="tenx-protected-field__row">
				<span aria-label={t(keys.encryptedValue)} className="tenx-protected-field__mask" role="img">
					&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;
				</span>
				<Button buttonStyle="secondary" onClick={onReveal} size="small">
					{t(keys.reveal)}
				</Button>
			</div>
		</div>
	)
}

const RichTextJsonView: React.FC<{ path: string } & Pick<ProtectedFieldProps, 'field'>> = ({
	field,
	path,
}) => {
	const { t } = useTranslation()
	const { value } = useField<unknown>({ path })
	return (
		<div className="field-type tenx-protected-field">
			<FieldLabel label={field.label} path={path} required={field.required} />
			<p className="tenx-protected-field__notice">{t(keys.richTextApiOnly)}</p>
			<pre className="tenx-protected-field__json">
				{value == null ? '' : JSON.stringify(value, null, 2)}
			</pre>
		</div>
	)
}

/**
 * Single admin dispatcher for encrypted fields. Concealed state renders a
 * masked row plus a reveal toggle; revealed (or protection 'none') renders the
 * true native component for the original type, with the serializable fieldPatch
 * restoring type-specific config (options, hasMany, date admin).
 *
 * Masking is visual-only by design. afterRead decrypts server-side, so the
 * field's form value is already plaintext regardless of the mask, and the mask
 * never binds to that value. Two accepted consequences: (a) the plaintext
 * reaches an authorized admin's browser, since that admin already has field
 * read access and masking only stops casual over-the-shoulder display; (b)
 * saving an unchanged document re-seals with a fresh IV (version churn),
 * because the form holds plaintext, not the stored ciphertext.
 */
export const ProtectedField: React.FC<ProtectedFieldProps> = (props) => {
	const { componentKey, field, fieldPatch, path, protection } = props
	const { t } = useTranslation()
	const [revealed, setRevealed] = useState(protection === 'none')

	const patchedField = useMemo(
		() => ({
			...field,
			...fieldPatch,
			admin: { ...field.admin, ...fieldPatch.admin },
		}),
		[field, fieldPatch]
	)

	if (componentKey === 'richText') {
		if (!revealed) {
			return (
				<MaskRow
					label={field.label}
					onReveal={() => setRevealed(true)}
					path={path}
					required={field.required}
				/>
			)
		}
		return (
			<div className="tenx-protected-field">
				<div className="tenx-protected-field__toolbar">
					<Button buttonStyle="pill" onClick={() => setRevealed(false)} size="small">
						{t(keys.conceal)}
					</Button>
				</div>
				<RichTextJsonView field={field} path={path} />
			</div>
		)
	}

	if (!revealed) {
		return (
			<MaskRow
				label={field.label}
				onReveal={() => setRevealed(true)}
				path={path}
				required={field.required}
			/>
		)
	}

	const Native = NATIVE[componentKey] ?? (TextField as AnyFieldComponent)
	if (protection === 'none') {
		return <Native {...(props as unknown as Record<string, unknown>)} field={patchedField} />
	}
	return (
		<div className="tenx-protected-field">
			<div className="tenx-protected-field__toolbar">
				<Button buttonStyle="pill" onClick={() => setRevealed(false)} size="small">
					{t(keys.conceal)}
				</Button>
			</div>
			<Native {...(props as unknown as Record<string, unknown>)} field={patchedField} />
		</div>
	)
}
