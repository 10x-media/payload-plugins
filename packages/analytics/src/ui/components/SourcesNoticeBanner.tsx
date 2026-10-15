'use client'

import { Banner } from '@payloadcms/ui'
import type { SourcesNotice } from '../../fields/config/fetchSources'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import '../analytics.css'

/** What a source listing tells its reader about itself, as a banner; nothing when it says nothing. */
export function SourcesNoticeBanner({ notice }: { notice: SourcesNotice | undefined }) {
	const { t } = useTranslation()
	return notice === 'platformFallback' ? (
		<Banner className="analytics-sources-notice" type="info">
			{t(keys.sourcesPlatformFallback)}
		</Banner>
	) : null
}
