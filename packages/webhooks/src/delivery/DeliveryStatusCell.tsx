'use client'

import { Pill } from '@payloadcms/ui'
import type { DefaultCellComponentProps } from 'payload'

import { keys, type TranslationKey } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'

type MetaEntry = { labelKey: TranslationKey; pillStyle: 'error' | 'light' | 'success' | 'warning' }

const META: Record<string, MetaEntry> = {
	pending: { labelKey: keys.statusPending, pillStyle: 'light' },
	success: { labelKey: keys.statusSuccess, pillStyle: 'success' },
	failed: { labelKey: keys.statusFailed, pillStyle: 'warning' },
	dead: { labelKey: keys.statusDead, pillStyle: 'error' },
}

const FALLBACK: MetaEntry = { labelKey: keys.statusPending, pillStyle: 'light' }

/** List cell rendering a delivery's status as a native Payload Pill. */
export const DeliveryStatusCell = ({ cellData }: DefaultCellComponentProps) => {
	const { t } = useTranslation()
	const meta = META[String(cellData)] ?? FALLBACK
	return (
		<Pill pillStyle={meta.pillStyle} size="small">
			{t(meta.labelKey)}
		</Pill>
	)
}
