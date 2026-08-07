'use client'

import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'
import { RichText } from '@payloadcms/richtext-lexical/react'

import { CALLOUT_VARIANTS, type CalloutVariant } from '../../editor/constants'

export type CalloutProps = {
	body?: SerializedEditorState | null
	variant?: string | null
}

const normalizeVariant = (variant: string | null | undefined): CalloutVariant =>
	(CALLOUT_VARIANTS as readonly string[]).includes(variant ?? '')
		? (variant as CalloutVariant)
		: 'info'

/** The built-in callout block as rendered in guides. */
export const Callout = ({ body, variant }: CalloutProps) => (
	<aside className={`wiki-callout wiki-callout--${normalizeVariant(variant)}`}>
		{body ? <RichText data={body} disableContainer /> : null}
	</aside>
)
