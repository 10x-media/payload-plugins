'use client'

import { useConfig } from '@payloadcms/ui'
import { formatDate } from '@payloadcms/ui/shared'
import type { DefaultCellComponentProps } from 'payload'

import { useTranslation } from '../translations/useTranslation'
import { formatRelativeTime } from './formatRelativeTime'

const DEFAULT_DATE_FORMAT = 'MMMM do yyyy, h:mm a'

/** List cell for date fields: relative time, with the admin-formatted timestamp on hover. */
export const RelativeTimeCell = ({ cellData }: DefaultCellComponentProps) => {
	const { config } = useConfig()
	const { i18n } = useTranslation()

	if (cellData === null || cellData === undefined) {
		return null
	}
	const relative = formatRelativeTime(cellData, Date.now(), i18n.language)
	if (!relative) {
		return null
	}
	const exact = formatDate({
		date: cellData,
		i18n,
		pattern: config.admin?.dateFormat ?? DEFAULT_DATE_FORMAT,
	})
	return <span title={exact}>{relative}</span>
}
