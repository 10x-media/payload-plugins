'use client'

import { Button, DatePicker } from '@payloadcms/ui'
import { useCallback, useState } from 'react'
import { keys } from '../../../../translations/keys'
import { useTranslation } from '../../../../translations/useTranslation'
import type { EditorProps } from './types.js'

const toISO = (val: Date | string): string | undefined => {
	if (!val) return undefined
	if (val instanceof Date) return val.toISOString()
	return val
}

export function DateRangeEditor({ onClose, setStaged, staged }: EditorProps) {
	const { t } = useTranslation()
	const [from, setFrom] = useState<Date | string>(staged.dateFrom ?? '')
	const [to, setTo] = useState<Date | string>(staged.dateTo ?? '')

	const commit = useCallback(() => {
		setStaged((f) => ({
			...f,
			dateFrom: toISO(from),
			dateTo: toISO(to),
		}))
		onClose()
	}, [from, to, onClose, setStaged])

	return (
		<div className="al-filterpopover__editor" data-popup-prevent-close>
			<div className="al-filterpopover__editor-label">{t(keys.filterDateRange)}</div>
			<div className="al-filterpopover__date-row">
				<span className="al-filterpopover__date-label">{t(keys.dateFrom)}</span>
				<DatePicker
					onChange={(val) => setFrom(val as Date | string)}
					placeholder={t(keys.startDate)}
					value={from}
				/>
			</div>
			<div className="al-filterpopover__date-row">
				<span className="al-filterpopover__date-label">{t(keys.dateTo)}</span>
				<DatePicker
					onChange={(val) => setTo(val as Date | string)}
					placeholder={t(keys.endDate)}
					value={to}
				/>
			</div>
			<div className="al-filterpopover__actions">
				<Button buttonStyle="primary" margin={false} onClick={commit}>
					{t(keys.apply)}
				</Button>
			</div>
		</div>
	)
}
