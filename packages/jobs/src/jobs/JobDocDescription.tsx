'use client'

import { useDocumentInfo } from '@payloadcms/ui'
import { useEffect, useRef, useState } from 'react'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'

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
		<div
			style={{
				alignItems: 'center',
				color: 'var(--theme-elevation-500)',
				display: 'flex',
				fontSize: '0.8125rem',
				gap: '6px',
			}}
		>
			<span style={{ fontSize: '0.6875rem', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
				{t(keys.fieldId)}
			</span>
			<code style={{ fontFamily: 'var(--font-mono, monospace)' }}>{value}</code>
			<button
				onClick={copy}
				style={{
					background: 'none',
					border: 'none',
					color: 'var(--theme-elevation-400)',
					cursor: 'pointer',
					font: 'inherit',
					padding: 0,
					textDecoration: 'underline',
				}}
				type="button"
			>
				{copied ? t(keys.copied) : t(keys.copy)}
			</button>
		</div>
	)
}
