'use client'

import { FieldDescription, FieldLabel, useField } from '@payloadcms/ui'
import type { ChangeEvent } from 'react'
import { formatBytes } from '../uploads/formatBytes'
import { toStaticLabel } from './toStaticLabel'

/** Props: standard number field client props; label and description arrive resolved on `field`. */
export type ByteSizeFieldProps = {
	path?: string
	field?: { label?: unknown; admin?: { description?: unknown } }
	label?: unknown
}

/**
 * The `Field` mounted on a byte-count number config field (the file field's `maxSize`): a plain
 * number input that live-previews the value as a human-readable size ('= 2.5 MB') so authors are
 * not left decoding raw bytes. Stores the raw byte number unchanged.
 */
export const ByteSizeField = (props: ByteSizeFieldProps) => {
	const { path, setValue, value } = useField<number>({ path: props.path })
	const label = toStaticLabel(props.field?.label ?? props.label)
	const description = toStaticLabel(props.field?.admin?.description)

	const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
		if (event.target.value === '') {
			setValue(null)
			return
		}
		const parsed = Number(event.target.value)
		if (Number.isFinite(parsed)) {
			setValue(parsed)
		}
	}

	return (
		<div className="field-type number" style={{ marginBlockEnd: '1rem' }}>
			<FieldLabel label={label} path={path} />
			<div className="field-type__wrap">
				<input
					id={`field-${path.replace(/\./g, '__')}`}
					min={0}
					name={path}
					onChange={handleChange}
					type="number"
					value={typeof value === 'number' ? value : ''}
				/>
				{typeof value === 'number' && value > 0 ? (
					<div className="field-description">{`= ${formatBytes(value)}`}</div>
				) : null}
				<FieldDescription description={description} path={path} />
			</div>
		</div>
	)
}
