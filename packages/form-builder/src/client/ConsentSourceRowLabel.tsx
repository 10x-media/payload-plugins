'use client'

import { useRowLabel } from '@payloadcms/ui'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'

type RowData = { name?: unknown }

/**
 * Row header for a consent source array row: shows the source `name` (e.g. "Privacy Policy") instead
 * of Payload's default "Consent source NN". Falls back to the singular label + number while unnamed.
 */
export const ConsentSourceRowLabel = () => {
	const { data, rowNumber } = useRowLabel<RowData>()
	const { t } = useTranslation()
	const name = typeof data?.name === 'string' && data.name.trim().length > 0 ? data.name.trim() : ''
	const number = String((rowNumber ?? 0) + 1).padStart(2, '0')
	return <span>{name || `${t(keys.consentSourceSingular)} ${number}`}</span>
}
