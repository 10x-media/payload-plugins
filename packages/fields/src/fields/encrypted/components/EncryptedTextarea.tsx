'use client'
import {
	FieldDescription,
	FieldError,
	FieldLabel,
	useField,
	useFormFields,
	useFormSubmitted,
} from '@payloadcms/ui'
import { mergeFieldStyles } from '@payloadcms/ui/shared'
import type React from 'react'
import { useMemo, useState } from 'react'
import { EyeToggle } from './EyeToggle'
import { dotString } from './MaskDots'
import type { EncryptedFieldConfig } from './placement'

interface EncryptedTextareaProps {
	field: EncryptedFieldConfig
	maskDots: number
	path: string
}

/**
 * The revealed, bound textarea. The only part that calls `useField`; the
 * concealed state renders a readOnly dots textarea instead, so masking cannot
 * write form state. Validation stays server-side.
 */
const BoundTextarea: React.FC<{ field: EncryptedFieldConfig; path: string }> = ({
	field,
	path,
}) => {
	const { setValue, value } = useField<string>({ path })
	return (
		<div className="textarea-outer">
			<textarea
				className="tenx-protected-field__revealed-textarea"
				id={`field-${path.replace(/\./g, '__')}`}
				name={path}
				onChange={(event) => setValue(event.target.value)}
				rows={field.admin?.rows}
				value={typeof value === 'string' ? value : ''}
			/>
		</div>
	)
}

/**
 * Corner-placement wrapper for textarea. Renders the stable native chrome with
 * the eye pinned to the top-right corner of the field wrap; only the textarea
 * swaps between the concealed dots facsimile and the bound textarea. The wrapper
 * only reads form state (no `useField`, no `setValue`).
 */
export const EncryptedTextarea: React.FC<EncryptedTextareaProps> = ({ field, maskDots, path }) => {
	const [revealed, setRevealed] = useState(false)
	const submitted = useFormSubmitted()
	const invalid = useFormFields(([fields]) => fields?.[path]?.valid === false)
	const showError = submitted && invalid
	// A custom Field component short-circuits the path where Payload applies
	// admin.width and admin.style, so the field has to carry them itself.
	const styles = useMemo(() => mergeFieldStyles(field), [field])

	return (
		<div
			className={[
				'field-type',
				'textarea',
				showError && 'error',
				'tenx-protected-field',
				'tenx-protected-field--corner',
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
				{revealed ? (
					<BoundTextarea field={field} path={path} />
				) : (
					<div className="textarea-outer">
						<textarea
							className="tenx-protected-field__masked-textarea"
							readOnly
							rows={field.admin?.rows}
							tabIndex={-1}
							value={dotString(maskDots)}
						/>
					</div>
				)}
				<div className="tenx-protected-field__eye-wrap tenx-protected-field__eye-wrap--corner">
					<EyeToggle
						className="tenx-protected-field__eye--floating"
						onToggle={() => setRevealed((prev) => !prev)}
						revealed={revealed}
					/>
				</div>
				<FieldDescription description={field.admin?.description} path={path} />
			</div>
		</div>
	)
}
