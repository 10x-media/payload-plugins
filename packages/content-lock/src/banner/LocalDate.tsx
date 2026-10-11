'use client'

import { useTranslation } from '@payloadcms/ui'
import { useEffect, useState } from 'react'

import type { DateFormat } from '../lexical/token/types'
import { formatInstant, formatInstantFull } from './formatDate'
import { intlLanguage } from './locale'

/**
 * An instant rendered in the viewer's locale and time zone. It formats after
 * mount: the server knows neither, and guessing would mismatch on hydration.
 */
export const LocalDate = ({
	iso,
	format = 'datetime',
	className,
	language,
}: {
	iso: string
	format?: DateFormat
	className?: string
	/** Format in this locale instead of the admin language, e.g. a message's content locale. */
	language?: string
}) => {
	const { i18n } = useTranslation()
	const [text, setText] = useState<string | null>(null)
	const [full, setFull] = useState<string | undefined>(undefined)
	useEffect(() => {
		const tag = intlLanguage(language, i18n.language)
		setFull(formatInstantFull(iso, tag))
		let timer: ReturnType<typeof setTimeout> | undefined
		const render = () => {
			const now = Date.now()
			setText(formatInstant({ iso, format, language: tag, now }))
			if (format === 'relative') {
				// Seconds count in the last stretch; otherwise minutes are the finest unit.
				const near = Math.abs(Date.parse(iso) - now) < 90_000
				timer = setTimeout(render, near ? 1_000 : 30_000)
			}
		}
		render()
		return () => clearTimeout(timer)
	}, [iso, format, language, i18n.language])
	return (
		<time className={className} dateTime={iso} suppressHydrationWarning title={full}>
			{text ?? ''}
		</time>
	)
}
