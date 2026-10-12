'use client'

import { FieldLabel, useField, useFormFields, useRowLabel } from '@payloadcms/ui'
import type { CSSProperties, ReactNode } from 'react'

/**
 * Dev stand only: inputs that do not look like Payload's own, for the `showcases`
 * collection, to see how the merge screen draws them.
 */

type FieldProps = {
	path: string
	readOnly?: boolean
	field: { label?: unknown; name: string }
}

const labelOf = (field: FieldProps['field']): string =>
	typeof field.label === 'string' ? field.label : field.name

const box: CSSProperties = {
	display: 'flex',
	alignItems: 'center',
	gap: 8,
	padding: '6px 10px',
	border: '1px dashed var(--theme-elevation-400)',
	borderRadius: 6,
	background: 'var(--theme-elevation-50)',
}

const input: CSSProperties = {
	border: '1px solid var(--theme-elevation-150)',
	borderRadius: 4,
	padding: '4px 8px',
	background: 'var(--theme-input-bg)',
	color: 'var(--theme-text)',
}

const Shell = ({ label, children }: { label: string; children: ReactNode }) => (
	<div className="field-type" style={{ marginBottom: 16 }}>
		<FieldLabel label={label} />
		<div style={box}>{children}</div>
	</div>
)

/** A text field drawn as a swatch next to its hex value. */
export const ColorField = ({ path, field, readOnly }: FieldProps) => {
	const { value, setValue } = useField<string>({ path })
	return (
		<Shell label={labelOf(field)}>
			<span
				style={{
					width: 24,
					height: 24,
					borderRadius: '50%',
					background: value || 'transparent',
					border: '1px solid var(--theme-elevation-300)',
				}}
			/>
			<input
				disabled={readOnly}
				onChange={(event) => setValue(event.target.value)}
				style={input}
				value={value ?? ''}
			/>
		</Shell>
	)
}

/** A number field drawn as five stars. */
export const RatingField = ({ path, field, readOnly }: FieldProps) => {
	const { value, setValue } = useField<number>({ path })
	return (
		<Shell label={labelOf(field)}>
			{[1, 2, 3, 4, 5].map((star) => (
				<button
					disabled={readOnly}
					key={star}
					onClick={() => setValue(star)}
					style={{ border: 0, background: 'none', fontSize: 20, cursor: 'pointer' }}
					type="button"
				>
					{star <= (value ?? 0) ? '★' : '☆'}
				</button>
			))}
		</Shell>
	)
}

/** A group of country and number drawn as one phone input. */
export const PhoneField = ({ path, field, readOnly }: FieldProps) => {
	const country = useField<string>({ path: `${path}.country` })
	const number = useField<string>({ path: `${path}.number` })
	return (
		<Shell label={labelOf(field)}>
			<input
				disabled={readOnly}
				onChange={(event) => country.setValue(event.target.value)}
				placeholder="+49"
				style={{ ...input, width: 64 }}
				value={country.value ?? ''}
			/>
			<input
				disabled={readOnly}
				onChange={(event) => number.setValue(event.target.value)}
				placeholder="30 1234567"
				style={{ ...input, flex: 1 }}
				value={number.value ?? ''}
			/>
		</Shell>
	)
}

/** A group of amount and currency drawn as one money input. */
export const MoneyField = ({ path, field, readOnly }: FieldProps) => {
	const amount = useField<number>({ path: `${path}.amount` })
	const currency = useField<string>({ path: `${path}.currency` })
	return (
		<Shell label={labelOf(field)}>
			<input
				disabled={readOnly}
				onChange={(event) => amount.setValue(Number(event.target.value))}
				style={{ ...input, width: 120 }}
				type="number"
				value={amount.value ?? ''}
			/>
			<select
				disabled={readOnly}
				onChange={(event) => currency.setValue(event.target.value)}
				style={input}
				value={currency.value ?? ''}
			>
				{['', 'EUR', 'USD', 'UAH'].map((code) => (
					<option key={code} value={code}>
						{code || '-'}
					</option>
				))}
			</select>
		</Shell>
	)
}

/** A description drawn by a component rather than given as a string. */
export const WebsiteDescription = () => (
	<div className="field-description" style={{ color: 'var(--theme-success-500)' }}>
		Custom description component: the public URL, with <code>https://</code>.
	</div>
)

/** An array row named after its person and role. */
export const ContactRowLabel = () => {
	const { data, rowNumber } = useRowLabel<{ person?: string; role?: string }>()
	const name = data?.person || `Contact ${String((rowNumber ?? 0) + 1).padStart(2, '0')}`
	return (
		<span>
			{name}
			{data?.role ? <em style={{ opacity: 0.6 }}> ({data.role})</em> : null}
		</span>
	)
}

/** A block row named after its own text. */
export const SectionRowLabel = () => {
	const { data } = useRowLabel<{ blockType?: string; text?: string; title?: string }>()
	return <span>§ {data?.text || data?.title || data?.blockType}</span>
}

/** An array drawn as chips, without Payload's array rows. */
export const ChipsArrayField = ({ path, field }: FieldProps) => {
	const { value: count } = useField<number>({ path })
	const rows = useFormFields(([fields]) =>
		Array.from({ length: Number(count) || 0 }, (_, index) => ({
			text: fields[`${path}.${index}.text`]?.value as string | undefined,
			tone: fields[`${path}.${index}.tone`]?.value as string | undefined,
		}))
	)
	const colors: Record<string, string> = {
		warning: 'var(--theme-warning-500)',
		success: 'var(--theme-success-500)',
	}
	return (
		<Shell label={labelOf(field)}>
			{rows.length === 0 ? <span style={{ opacity: 0.6 }}>No labels</span> : null}
			{rows.map((row, index) => (
				<span
					key={index}
					style={{
						padding: '2px 10px',
						borderRadius: 999,
						color: '#fff',
						background: colors[row.tone ?? ''] ?? 'var(--theme-elevation-500)',
					}}
				>
					{row.text}
				</span>
			))}
		</Shell>
	)
}
