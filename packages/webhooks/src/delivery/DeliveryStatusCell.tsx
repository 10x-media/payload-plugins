'use client'

import { Pill } from '@payloadcms/ui'
import type { DefaultCellComponentProps } from 'payload'

import { keys, type TranslationKey } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import './DeliveryStatusCell.css'

type MetaEntry = {
	className?: string
	labelKey: TranslationKey
	pillStyle: 'error' | 'light' | 'warning'
}

/**
 * Payload 4's `success` pill is its blue selection color, so a delivered row takes the green
 * success tokens through a class of its own, as the jobs dashboard does for a succeeded job.
 */
const META: Record<string, MetaEntry> = {
	pending: { labelKey: keys.statusPending, pillStyle: 'light' },
	success: {
		className: 'webhooks-pill--success',
		labelKey: keys.statusSuccess,
		pillStyle: 'light',
	},
	failed: { labelKey: keys.statusFailed, pillStyle: 'warning' },
	dead: { labelKey: keys.statusDead, pillStyle: 'error' },
}

const FALLBACK: MetaEntry = { labelKey: keys.statusPending, pillStyle: 'light' }

/** List cell rendering a delivery's status as a native Payload Pill. */
export const DeliveryStatusCell = ({ cellData }: DefaultCellComponentProps) => {
	const { t } = useTranslation()
	const meta = META[String(cellData)] ?? FALLBACK
	return (
		<Pill className={meta.className} pillStyle={meta.pillStyle} size="small">
			{t(meta.labelKey)}
		</Pill>
	)
}
