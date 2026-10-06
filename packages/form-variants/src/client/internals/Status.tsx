'use client'

import { useDocumentInfo, useTranslation } from '@payloadcms/ui'
import type React from 'react'

/**
 * The draft status of the document, on Payload's own `status` class names so the admin
 * stylesheet styles it. Reverting to the published version is a document control and stays on
 * the native form, so this is a read-only indicator.
 *
 * Payload's own `Status` is not exported from `@payloadcms/ui`; see `./index.ts` for why
 * importing it from its subpath is not an option.
 */
const BASE_CLASS = 'status'

const LABELS = {
	changed: 'version:changed',
	draft: 'version:draft',
	previouslyDraft: 'version:previouslyDraft',
	previouslyPublished: 'version:previouslyPublished',
	published: 'version:published',
} as const

export const Status: React.FC = () => {
	const { hasPublishedDoc, isTrashed, unpublishedVersionCount } = useDocumentInfo()
	const { t } = useTranslation()

	let state: keyof typeof LABELS
	if (isTrashed) {
		state = hasPublishedDoc ? 'previouslyPublished' : 'previouslyDraft'
	} else if (!hasPublishedDoc) {
		state = 'draft'
	} else if (unpublishedVersionCount > 0) {
		state = 'changed'
	} else {
		state = 'published'
	}

	const label = t('version:status')
	const value = t(LABELS[state])

	return (
		<div className={BASE_CLASS} title={`${label}: ${value}`}>
			<div className={`${BASE_CLASS}__value-wrap`}>
				<span className={`${BASE_CLASS}__label`}>{label}:&nbsp;</span>
				<span className={`${BASE_CLASS}__value`}>{value}</span>
			</div>
		</div>
	)
}
