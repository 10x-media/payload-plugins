'use client'

import { useInlineBlockComponentContext } from '@payloadcms/richtext-lexical/client'

import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'

/** Authoring-view chip label for the guide-link inline block. */
export const GuideLinkBlockLabel = () => {
	const { t } = useTranslation()
	const context = useInlineBlockComponentContext() as {
		formData?: { guide?: unknown; label?: unknown }
	}
	const formData = context?.formData
	const label = typeof formData?.label === 'string' && formData.label ? formData.label : null
	const guide = formData?.guide
	const guideTitle =
		typeof guide === 'object' && guide !== null && 'title' in guide
			? String((guide as { title?: unknown }).title ?? '')
			: null
	return <span>{label ?? guideTitle ?? t(keys.guideLinkBlockSingular)}</span>
}
