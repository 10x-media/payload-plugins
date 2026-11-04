'use client'

import { Banner, useField } from '@payloadcms/ui'
import type { JSONFieldClientProps } from 'payload'
import type { FC } from 'react'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { extractErrorMessage } from './extractErrorMessage'
import './jobs.css'

const isCancelled = (value: unknown): boolean =>
	typeof value === 'object' &&
	value !== null &&
	(value as { cancelled?: unknown }).cancelled === true

/**
 * Field component for a job's `error`: renders the reason as a read-only panel
 * instead of raw JSON. Cancellations read neutral; real failures read as errors.
 */
export const JobErrorPanel: FC<JSONFieldClientProps> = ({ path }) => {
	const { value } = useField<unknown>({ path })
	const { t } = useTranslation()
	const message = extractErrorMessage(value)
	if (!message) {
		return null
	}

	const cancelled = isCancelled(value)

	return (
		<div className="jobs-error-panel">
			<div className="jobs-caption">{cancelled ? t(keys.outcome) : t(keys.fieldError)}</div>
			<Banner type={cancelled ? 'default' : 'danger'}>{message}</Banner>
		</div>
	)
}
