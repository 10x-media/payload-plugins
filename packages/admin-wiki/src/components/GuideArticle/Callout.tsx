'use client'

import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'
import { type JSXConverters, RichText } from '@payloadcms/richtext-lexical/react'

import { CALLOUT_VARIANTS, type CalloutVariant } from '../../editor/constants'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { CalloutIcon } from '../icons'
import { inlineConverters } from './inlineConverters'

export type CalloutProps = {
	body?: SerializedEditorState | null
	/**
	 * Converters for the body. Without them the body falls back to inline
	 * formatting and links, so consumer nodes render as `unknown node`.
	 */
	converters?: JSXConverters
	variant?: string | null
}

const normalizeVariant = (variant: string | null | undefined): CalloutVariant =>
	(CALLOUT_VARIANTS as readonly string[]).includes(variant ?? '')
		? (variant as CalloutVariant)
		: 'info'

const VARIANT_LABEL_KEYS = {
	danger: keys.calloutVariantDanger,
	info: keys.calloutVariantInfo,
	tip: keys.calloutVariantTip,
	warning: keys.calloutVariantWarning,
} as const

/**
 * The built-in callout block as rendered in guides. Follows the GitHub-alert
 * shape the seed transformer maps onto: a glyph and a level name, then the body,
 * so a warning still reads as a warning to someone skimming.
 */
export const Callout = ({ body, converters, variant }: CalloutProps) => {
	const { t } = useTranslation()
	const resolved = normalizeVariant(variant)
	return (
		<aside className={`wiki-callout wiki-callout--${resolved}`}>
			<p className="wiki-callout__label">
				<CalloutIcon size="small" variant={resolved} />
				{t(VARIANT_LABEL_KEYS[resolved])}
			</p>
			{body ? (
				<RichText converters={converters ?? inlineConverters} data={body} disableContainer />
			) : null}
		</aside>
	)
}
