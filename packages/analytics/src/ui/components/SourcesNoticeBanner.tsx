'use client'

import { Banner } from '@payloadcms/ui'
import type { SourcesNotice } from '../../fields/config/fetchSources'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import '../analytics.css'

/** What a source listing tells its reader about itself, as a banner; nothing when it says nothing. */
export function SourcesNoticeBanner({ notice }: { notice: SourcesNotice | undefined }) {
	const { t } = useTranslation()
	if (notice === undefined) {
		return null
	}
	return (
		<Banner className="analytics-sources-notice" type="info">
			{t(
				notice === 'ownSourceFailing' ? keys.sourcesOwnSourceFailing : keys.sourcesPlatformFallback
			)}
		</Banner>
	)
}
