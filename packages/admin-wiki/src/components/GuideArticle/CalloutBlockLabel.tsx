'use client'

import { Pill, useFormFields } from '@payloadcms/ui'

import { CALLOUT_VARIANTS, type CalloutVariant } from '../../editor/constants'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { CalloutIcon } from '../icons'
import './callout-label.css'

const VARIANT_LABEL_KEYS = {
	danger: keys.calloutVariantDanger,
	info: keys.calloutVariantInfo,
	tip: keys.calloutVariantTip,
	warning: keys.calloutVariantWarning,
} as const

/**
 * Authoring label for the callout block. Payload's default renders the block's
 * name in a neutral pill, which tells an author nothing about which of the four
 * levels they picked; this reads the block form's own `variant` and shows the
 * level, so a warning looks like a warning while it is being written.
 *
 * Rendered inside the block's scoped Form, which is what makes `useFormFields`
 * resolve `variant` rather than a field of the guide document around it.
 */
export const CalloutBlockLabel = () => {
	const { t } = useTranslation()
	const stored = useFormFields(([fields]) => fields?.variant?.value)
	const variant: CalloutVariant = (CALLOUT_VARIANTS as readonly string[]).includes(
		typeof stored === 'string' ? stored : ''
	)
		? (stored as CalloutVariant)
		: 'info'

	return (
		<span className={`wiki-callout-label wiki-callout-label--${variant}`}>
			<Pill className="wiki-callout-label__pill" pillStyle="white" size="small">
				<CalloutIcon size="small" variant={variant} />
				{t(keys.calloutBlockSingular)}
				<span className="wiki-callout-label__variant">{t(VARIANT_LABEL_KEYS[variant])}</span>
			</Pill>
		</span>
	)
}
