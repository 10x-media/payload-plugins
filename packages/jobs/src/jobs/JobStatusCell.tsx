'use client'

import { Link, Pill, useConfig } from '@payloadcms/ui'
import type { DefaultCellComponentProps } from 'payload'

import { useTranslation } from '../translations/useTranslation'
import { deriveJobStatus } from './deriveJobStatus'
import { jobStatusMeta } from './jobStatusMeta'

/**
 * List cell that renders a job's derived status as a native Payload Pill. On the
 * linked (first) column it wraps the badge in a link to the document, matching
 * Payload's default cell behavior.
 */
export const JobStatusCell = ({
	collectionSlug,
	link,
	linkURL,
	rowData,
}: DefaultCellComponentProps) => {
	const { config } = useConfig()
	const { t } = useTranslation()
	const { labelKey, pillStyle } = jobStatusMeta[deriveJobStatus(rowData ?? {})]
	const pill = (
		<Pill pillStyle={pillStyle} size="small">
			{t(labelKey)}
		</Pill>
	)

	if (link && collectionSlug && rowData?.id != null) {
		const adminRoute = config.routes?.admin ?? '/admin'
		const href =
			linkURL ??
			`${adminRoute}/collections/${collectionSlug}/${encodeURIComponent(String(rowData.id))}`
		return (
			<Link href={href} prefetch={false}>
				{pill}
			</Link>
		)
	}

	return pill
}
