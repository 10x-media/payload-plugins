'use client'

import { useRowLabel } from '@payloadcms/ui'
import type { TranslationKey } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'

/** Props threaded from each field block's `admin.components.Label` clientProps. */
export type FieldBlockLabelProps = {
	/** The block's type-label key (e.g. `keys.fieldTypeText`), shown while the field has no label. */
	typeLabelKey?: string
}

type RowData = { label?: unknown }

/**
 * Row header for a field block. Payload's native collapsed-row header ends in the editable
 * `blockName`, which reads "Untitled" until someone fills it; a field already carries a `label`, so
 * this shows that instead, giving each row a "01 Text Full name" heading. Falls back to the block's
 * type label while the field is still unnamed. Because a custom block label replaces the whole native
 * header, it re-emits the row number and type the default would otherwise render.
 */
export const FieldBlockLabel = ({ typeLabelKey }: FieldBlockLabelProps) => {
	const { data, rowNumber } = useRowLabel<RowData>()
	const { t } = useTranslation()
	const typeLabel = typeLabelKey ? t(typeLabelKey as TranslationKey) : ''
	const fieldLabel =
		typeof data?.label === 'string' && data.label.trim().length > 0 ? data.label.trim() : ''
	const number = String((rowNumber ?? 0) + 1).padStart(2, '0')
	return (
		<span style={{ alignItems: 'center', display: 'inline-flex', gap: '0.5rem' }}>
			<span style={{ color: 'var(--theme-elevation-500)' }}>
				{typeLabel ? `${number} ${typeLabel}` : number}
			</span>
			{fieldLabel ? <span>{fieldLabel}</span> : null}
		</span>
	)
}
