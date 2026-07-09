'use client'

import { Link, Pill, useConfig } from '@payloadcms/ui'
import { formatDate } from '@payloadcms/ui/shared'
import type { DefaultCellComponentProps } from 'payload'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { deriveJobStatus } from './deriveJobStatus'
import { formatRelativeTime } from './formatRelativeTime'
import { jobStatusMeta } from './jobStatusMeta'

const DEFAULT_DATE_FORMAT = 'MMMM do yyyy, h:mm a'

/**
 * List cell for a job's derived status: the status Pill (linked on the first
 * column, matching Payload's default cell), a Cron badge for schedule-created
 * documents, and the next run time for scheduled jobs.
 */
export const JobStatusCell = ({
	collectionSlug,
	link,
	linkURL,
	rowData,
}: DefaultCellComponentProps) => {
	const { config } = useConfig()
	const { i18n, t } = useTranslation()
	const status = deriveJobStatus(rowData ?? {})
	const { labelKey, pillStyle } = jobStatusMeta[status]
	const pill = (
		<Pill pillStyle={pillStyle} size="small">
			{t(labelKey)}
		</Pill>
	)

	const linked =
		link && collectionSlug && rowData?.id != null ? (
			<Link
				href={
					linkURL ??
					`${config.routes?.admin ?? '/admin'}/collections/${collectionSlug}/${encodeURIComponent(String(rowData.id))}`
				}
				prefetch={false}
			>
				{pill}
			</Link>
		) : (
			pill
		)

	// meta.scheduled is set by Payload's handleSchedules on cron-created docs.
	const cron = (rowData?.meta as { scheduled?: boolean } | undefined)?.scheduled === true
	const waitUntil = typeof rowData?.waitUntil === 'string' ? rowData.waitUntil : undefined
	const nextRun = status === 'scheduled' ? waitUntil : undefined
	const exact = nextRun
		? formatDate({
				date: nextRun,
				i18n,
				pattern: config.admin?.dateFormat ?? DEFAULT_DATE_FORMAT,
			})
		: undefined

	return (
		<span style={{ alignItems: 'center', display: 'inline-flex', gap: 'calc(var(--base) / 4)' }}>
			{linked}
			{cron ? (
				<Pill pillStyle="light-gray" size="small">
					{t(keys.cronBadge)}
				</Pill>
			) : null}
			{nextRun ? (
				<span style={{ color: 'var(--theme-elevation-500)' }} title={exact}>
					{formatRelativeTime(nextRun, Date.now(), i18n.language)}
				</span>
			) : null}
		</span>
	)
}
