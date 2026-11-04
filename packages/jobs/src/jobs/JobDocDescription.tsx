'use client'

import { CopyToClipboard, useDocumentInfo } from '@payloadcms/ui'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import './jobs.css'

/** Document-header description for a job: the record ID, kept accessible and copyable. */
export const JobDocDescription = () => {
	const { id } = useDocumentInfo()
	const { t } = useTranslation()

	if (id == null) {
		return null
	}
	const value = String(id)

	return (
		<div className="jobs-doc-id">
			<span>{t(keys.fieldId)}</span>
			<code>{value}</code>
			<CopyToClipboard
				defaultMessage={t(keys.copy)}
				successMessage={t(keys.copied)}
				value={value}
			/>
		</div>
	)
}
