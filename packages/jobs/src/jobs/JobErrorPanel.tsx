'use client'

import { useField } from '@payloadcms/ui'
import type { JSONFieldClientComponent } from 'payload'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { extractErrorMessage } from './extractErrorMessage'

const isCancelled = (value: unknown): boolean =>
	typeof value === 'object' &&
	value !== null &&
	(value as { cancelled?: unknown }).cancelled === true

/**
 * Field component for a job's `error`: renders the reason as a read-only panel
 * instead of raw JSON. Cancellations read neutral; real failures read as errors.
 */
export const JobErrorPanel: JSONFieldClientComponent = ({ path }) => {
	const { value } = useField<unknown>({ path })
	const { t } = useTranslation()
	const message = extractErrorMessage(value)
	if (!message) {
		return null
	}

	const cancelled = isCancelled(value)
	const accent = cancelled ? 'var(--theme-elevation-400)' : 'var(--theme-error-500)'

	return (
		<div style={{ marginBottom: 'var(--base)' }}>
			<div
				style={{
					color: 'var(--theme-elevation-500)',
					fontSize: '0.6875rem',
					letterSpacing: '0.04em',
					marginBottom: '4px',
					textTransform: 'uppercase',
				}}
			>
				{cancelled ? t(keys.outcome) : t(keys.fieldError)}
			</div>
			<div
				style={{
					backgroundColor: 'var(--theme-elevation-50)',
					borderLeft: `3px solid ${accent}`,
					borderRadius: '0 4px 4px 0',
					color: 'var(--theme-elevation-800)',
					padding: 'calc(var(--base) / 1.5)',
					wordBreak: 'break-word',
				}}
			>
				{message}
			</div>
		</div>
	)
}
