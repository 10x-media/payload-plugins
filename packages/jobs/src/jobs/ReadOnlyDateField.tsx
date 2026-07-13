'use client'

import { FieldLabel, useConfig, useField } from '@payloadcms/ui'
import { formatDate } from '@payloadcms/ui/shared'
import type { DateFieldClientComponent } from 'payload'

import { useTranslation } from '../translations/useTranslation'
import { formatRelativeTime } from './formatRelativeTime'

const DEFAULT_DATE_FORMAT = 'MMMM do yyyy, h:mm a'

/**
 * Read-only date display with native field chrome. Payload's DatePicker renders
 * a clear button even when readOnly, so runner-written dates get this instead:
 * a relative value ("in 3 hours", "30 seconds ago") with the exact timestamp on
 * hover, and an em dash when empty.
 */
export const ReadOnlyDateField: DateFieldClientComponent = ({ field, path }) => {
	const { value } = useField<string>({ path })
	const { config } = useConfig()
	const { i18n } = useTranslation()

	const relative = value ? formatRelativeTime(value, Date.now(), i18n.language) : ''
	const exact = value
		? formatDate({ date: value, i18n, pattern: config.admin?.dateFormat ?? DEFAULT_DATE_FORMAT })
		: undefined

	return (
		<div className="field-type date-time-field">
			<FieldLabel label={field.label} path={path} />
			<span
				style={{
					color: relative ? undefined : 'var(--theme-elevation-400)',
					cursor: exact ? 'help' : undefined,
				}}
				title={exact}
			>
				{relative || '—'}
			</span>
		</div>
	)
}
