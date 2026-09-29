'use client'

import { useTranslation } from '@payloadcms/ui'
import { useEffect, useState } from 'react'

import type { DateFormat } from '../lexical/dateBlock'
import { formatInstant, formatInstantFull } from './formatDate'

/**
 * An instant rendered in the viewer's locale and time zone. It formats after
 * mount: the server knows neither, and guessing would mismatch on hydration.
 */
export const LocalDate = ({ iso, format = 'datetime' }: { iso: string; format?: DateFormat }) => {
	const { i18n } = useTranslation()
	const [text, setText] = useState<string | null>(null)
	const [full, setFull] = useState<string | undefined>(undefined)
	useEffect(() => {
		setText(formatInstant({ iso, format, language: i18n.language, now: Date.now() }))
		setFull(formatInstantFull(iso, i18n.language))
	}, [iso, format, i18n.language])
	return (
		<time dateTime={iso} suppressHydrationWarning title={full}>
			{text ?? ''}
		</time>
	)
}
