'use client'

import { Button, ReactSelect, useTranslation } from '@payloadcms/ui'
import React from 'react'

import type {
	CustomTranslationsKeys,
	CustomTranslationsObject,
} from '../../../../translations/index.js'

import type { Filters } from '../../types.js'
import type { EditorProps, SelectOption } from './types.js'

type Props = EditorProps & {
	field: 'collections' | 'globals' | 'operations' | 'tenants'
	label: string
	options: SelectOption[]
}

export function MultiSelectEditor({ field, label, onClose, options, setStaged, staged }: Props) {
	const { t } = useTranslation<CustomTranslationsObject, CustomTranslationsKeys>()
	const currentValues = staged[field] ?? []

	return (
		<div className="al-filterpopover__editor" data-popup-prevent-close>
			<div className="al-filterpopover__editor-label">{label}</div>
			<ReactSelect
				isMulti
				onChange={(selected) => {
					const values = (selected as SelectOption[] | null)?.map((o) => o.value) ?? []
					setStaged((f) => {
						const next: Filters = { ...f, [field]: values.length ? values : undefined }
						if (field === 'operations' && !values.includes('auth') && !values.includes('custom')) {
							delete next.eventType
						}
						return next
					})
				}}
				options={options}
				placeholder={t(keys.selectPlaceholder)}
				value={options.filter((o) => currentValues.includes(o.value))}
			/>
			<div className="al-filterpopover__actions">
				<Button margin={false} onClick={onClose}>
					{t(keys.done)}
				</Button>
			</div>
		</div>
	)
}
