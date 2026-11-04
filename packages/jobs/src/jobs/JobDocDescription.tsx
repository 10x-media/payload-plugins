'use client'

import { useDocumentInfo } from '@payloadcms/ui'
import { useEffect, useRef, useState } from 'react'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import './jobs.css'

/** Document-header description for a job: the record ID, kept accessible and copyable. */
export const JobDocDescription = () => {
	const { id } = useDocumentInfo()
	const { t } = useTranslation()
	const [copied, setCopied] = useState(false)
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

	useEffect(() => () => clearTimeout(timer.current), [])

	if (id == null) {
		return null
	}
	const value = String(id)
	const copy = () => {
		void navigator.clipboard?.writeText(value)
		setCopied(true)
		clearTimeout(timer.current)
		timer.current = setTimeout(() => setCopied(false), 1200)
	}

	return (
		<div className="jobs-doc-id">
			<span className="jobs-caption">{t(keys.fieldId)}</span>
			<code>{value}</code>
			<button className="jobs-reset-button" onClick={copy} type="button">
				{copied ? t(keys.copied) : t(keys.copy)}
			</button>
		</div>
	)
}
