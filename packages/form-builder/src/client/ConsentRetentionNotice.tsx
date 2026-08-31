'use client'

import { Banner } from '@payloadcms/ui'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'

/**
 * Sidebar notice mounted by the forms collection when a non-persisting form carries a consent
 * field (see `buildDefaultSettingsFields`): the consent proof is written at submit and pruned with
 * the row, so the combination only makes sense when the consent record lives elsewhere. A banner,
 * not a save error, because that external-record setup is legitimate; it just must not be silent.
 */
export const ConsentRetentionNotice = () => {
	const { t } = useTranslation()
	return <Banner type="info">{t(keys.formConsentRetentionNotice)}</Banner>
}
