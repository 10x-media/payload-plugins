'use client'
import {
	CalendarIcon,
	CheckboxInput,
	ChevronIcon,
	FieldDescription,
	FieldError,
	FieldLabel,
	InputStepper,
	useTranslation,
} from '@payloadcms/ui'
import type { StaticLabel } from 'payload'
import type React from 'react'
import { dotString, MaskDots } from './MaskDots'
import type { EncryptedFieldConfig } from './placement'

/**
 * Display-only concealed faces. Each reuses real Payload field markup with a
 * fixed run of dots so the masked state is pixel-native and inherits the global
 * `payload-default` styles (`.form-input` rows, Payload's own icons). None of them call
 * `useField` or hold `setValue`, so they are mechanically incapable of writing
 * the plaintext already sitting in form state.
 */
interface FaceProps {
	field: EncryptedFieldConfig
	maskDots: number
	path: string
}

const noop = (): undefined => undefined

/** A static label in the admin's language, the way Payload's own fields resolve one. */
const labelText = (label: StaticLabel | undefined, language: string): string => {
	if (typeof label === 'string') {
		return label
	}
	if (!label) {
		return ''
	}
	return label[language] ?? Object.values(label)[0] ?? ''
}

export const CheckboxFace: React.FC<FaceProps> = ({ field, path }) => (
	<div className="field-type checkbox tenx-protected-field__face">
		<FieldError path={path} />
		<CheckboxInput
			checked={false}
			label={field.label}
			name={path}
			onToggle={noop}
			partialChecked
			readOnly
			required={field.required}
		/>
		<FieldDescription description={field.admin?.description} path={path} />
	</div>
)

export const SelectFace: React.FC<FaceProps> = ({ field, maskDots, path }) => (
	<div className="field-type select tenx-protected-field__face" data-size="large">
		<FieldLabel
			label={field.label}
			localized={field.localized}
			path={path}
			required={field.required}
		/>
		<div className="field-type__wrap">
			<FieldError path={path} />
			<div className="react-select-container">
				<div className="react-select">
					<div className="rs__control tenx-protected-field__rs-control">
						<div className="value-container">
							<div className="rs__value-container">
								<MaskDots count={maskDots} />
							</div>
						</div>
						<div className="rs__indicators">
							<span className="rs__indicator-separator" />
							<div aria-hidden="true" className="dropdown-indicator">
								<ChevronIcon className="dropdown-indicator__icon" size={16} />
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
		<FieldDescription description={field.admin?.description} path={path} />
	</div>
)

export const RadioFace: React.FC<FaceProps> = ({ field, maskDots, path }) => (
	<div className="field-type radio-group radio-group--layout-horizontal tenx-protected-field__face">
		<FieldError path={path} />
		<div>
			<FieldLabel
				label={field.label}
				localized={field.localized}
				path={path}
				required={field.required}
			/>
		</div>
		<div className="field-type__wrap">
			<ul className="radio-group--group">
				<li>
					{/* biome-ignore lint/a11y/noLabelWithoutControl: display-only masked facsimile, no interactive input by design */}
					<label>
						<div className="radio-input">
							<span className="radio-input__styled-radio" />
							<span className="radio-input__label">
								<MaskDots count={maskDots} />
							</span>
						</div>
					</label>
				</li>
			</ul>
			<FieldDescription description={field.admin?.description} path={path} />
		</div>
	</div>
)

export const DateFace: React.FC<FaceProps> = ({ field, maskDots, path }) => (
	<div className="field-type date-time-field tenx-protected-field__face">
		<FieldLabel
			label={field.label}
			localized={field.localized}
			path={path}
			required={field.required}
		/>
		<div className="field-type__wrap">
			<FieldError path={path} />
			<div className="date-time-picker date-time-picker__appearance--default">
				<div className="date-time-picker__input-wrapper">
					<div className="react-datepicker-wrapper">
						<div className="react-datepicker__input-container">
							<input
								className="tenx-protected-field__masked-input"
								readOnly
								tabIndex={-1}
								value={dotString(maskDots)}
							/>
						</div>
					</div>
					<CalendarIcon />
				</div>
			</div>
		</div>
		<FieldDescription description={field.admin?.description} path={path} />
	</div>
)

const EditorFace: React.FC<FaceProps & { baseClass: string }> = ({
	baseClass,
	field,
	maskDots,
	path,
}) => (
	<div className={`field-type ${baseClass} tenx-protected-field__face`}>
		<FieldLabel
			label={field.label}
			localized={field.localized}
			path={path}
			required={field.required}
		/>
		<div className="field-type__wrap">
			<FieldError path={path} />
			<div className="tenx-protected-field__editor-box">
				<MaskDots count={maskDots} />
			</div>
		</div>
		<FieldDescription description={field.admin?.description} path={path} />
	</div>
)

export const CodeFace: React.FC<FaceProps> = (props) => (
	<EditorFace {...props} baseClass="code-field" />
)

export const JsonFace: React.FC<FaceProps> = (props) => (
	<EditorFace {...props} baseClass="json-field" />
)

/**
 * Point renders no field label of its own on v4: each coordinate carries
 * "<label> - Longitude" / "<label> - Latitude", so the face does the same.
 */
export const PointFace: React.FC<FaceProps> = ({ field, maskDots, path }) => {
	const { i18n, t } = useTranslation()
	const fieldLabel = labelText(field.label, i18n.language)
	const coordinate = (suffix: string): string => `${fieldLabel}${fieldLabel ? ' - ' : ''}${suffix}`
	return (
		<div className="field-type point tenx-protected-field__face">
			<ul className="point__wrap">
				{[t('fields:longitude'), t('fields:latitude')].map((suffix) => (
					<li key={suffix}>
						<FieldLabel
							label={coordinate(suffix)}
							localized={field.localized}
							path={path}
							required={field.required}
						/>
						<div className="form-input-group">
							<input
								className="form-input tenx-protected-field__masked-input"
								readOnly
								tabIndex={-1}
								value={dotString(maskDots)}
							/>
							<InputStepper disabled onDecrement={noop} onIncrement={noop} />
						</div>
					</li>
				))}
			</ul>
			<FieldDescription description={field.admin?.description} path={path} />
		</div>
	)
}
