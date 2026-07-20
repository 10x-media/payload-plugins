'use client'
import { CheckboxInput, FieldDescription, FieldError, FieldLabel } from '@payloadcms/ui'
import type React from 'react'
import { dotString, MaskDots } from './MaskDots'
import type { EncryptedFieldConfig } from './placement'

/**
 * Display-only concealed faces. Each reuses real Payload field markup with a
 * fixed run of dots so the masked state is pixel-native and inherits the global
 * `payload-default` styles (40px inputs, icon strokes). None of them call
 * `useField` or hold `setValue`, so they are mechanically incapable of writing
 * the plaintext already sitting in form state.
 */
interface FaceProps {
	field: EncryptedFieldConfig
	maskDots: number
	path: string
}

const noToggle = (): undefined => undefined

/** Chevron matching react-select's dropdown indicator (inherits `.icon--chevron`). */
const ChevronGlyph: React.FC = () => (
	<svg
		aria-hidden="true"
		className="icon icon--chevron"
		viewBox="0 0 20 20"
		xmlns="http://www.w3.org/2000/svg"
	>
		<path className="stroke" d="M14 8L10 12L6 8" strokeLinecap="square" />
	</svg>
)

/** Calendar glyph matching the datepicker (inherits `.icon--calendar` position). */
const CalendarGlyph: React.FC = () => (
	<svg
		aria-hidden="true"
		className="icon icon--calendar"
		viewBox="0 0 20 20"
		xmlns="http://www.w3.org/2000/svg"
	>
		<path
			className="stroke"
			d="M7.33333 3.33334V6M12.6667 3.33334V6M4 8.66667H16M5.33333 4.66667H14.6667C15.403 4.66667 16 5.26362 16 6V15.3333C16 16.0697 15.403 16.6667 14.6667 16.6667H5.33333C4.59695 16.6667 4 16.0697 4 15.3333V6C4 5.26362 4.59695 4.66667 5.33333 4.66667Z"
			strokeLinecap="square"
		/>
	</svg>
)

export const CheckboxFace: React.FC<FaceProps> = ({ field, path }) => (
	<div className="field-type checkbox tenx-protected-field__face">
		<FieldError path={path} />
		<CheckboxInput
			checked={false}
			label={field.label}
			name={path}
			onToggle={noToggle}
			partialChecked
			readOnly
			required={field.required}
		/>
		<FieldDescription description={field.admin?.description} path={path} />
	</div>
)

export const SelectFace: React.FC<FaceProps> = ({ field, maskDots, path }) => (
	<div className="field-type select tenx-protected-field__face">
		<FieldLabel
			label={field.label}
			localized={field.localized}
			path={path}
			required={field.required}
		/>
		<div className="field-type__wrap">
			<FieldError path={path} />
			<div className="react-select-container react-select">
				<div className="rs__control tenx-protected-field__rs-control">
					<div className="rs__value-container">
						<MaskDots count={maskDots} />
					</div>
					<div className="rs__indicators">
						<span className="rs__indicator rs__dropdown-indicator">
							<ChevronGlyph />
						</span>
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
		<FieldLabel
			label={field.label}
			localized={field.localized}
			path={path}
			required={field.required}
		/>
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
				<div className="date-time-picker__icon-wrap">
					<CalendarGlyph />
				</div>
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

export const PointFace: React.FC<FaceProps> = ({ field, maskDots, path }) => (
	<div className="field-type point tenx-protected-field__face">
		<FieldLabel
			label={field.label}
			localized={field.localized}
			path={path}
			required={field.required}
		/>
		<ul className="point__wrap">
			<li>
				<div className="input-wrapper">
					<input
						className="tenx-protected-field__masked-input"
						readOnly
						tabIndex={-1}
						value={dotString(maskDots)}
					/>
				</div>
			</li>
			<li>
				<div className="input-wrapper">
					<input
						className="tenx-protected-field__masked-input"
						readOnly
						tabIndex={-1}
						value={dotString(maskDots)}
					/>
				</div>
			</li>
		</ul>
		<FieldDescription description={field.admin?.description} path={path} />
	</div>
)
