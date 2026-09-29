import type { SerializedInlineBlockNode } from '@payloadcms/richtext-lexical'
import type { JSXConvertersFunction } from '@payloadcms/richtext-lexical/react'

import { DATE_BLOCK_SLUG, type DateFormat, type DateSource } from '../lexical/dateBlock'
import { SCOPE_BLOCK_SLUG } from '../lexical/scopeBlock'
import { LocalDate } from './LocalDate'

type DateBlockFields = { source?: DateSource; date?: string; format?: DateFormat }

/** The window a message belongs to, as its inline blocks read it. */
export type MessageContext = {
	startsAt: string
	/** `null` when the window ends manually. */
	endsAt: string | null
	announceAt: string | null
	/** Scope labels in the viewer's language, or `null` for everything. */
	scopeLabels: string[] | null
	/** Text for "all content", in the viewer's language. */
	everythingLabel: string
	/** Text standing in for an end that is not known yet, in the viewer's language. */
	openEndLabel: string
}

/**
 * Default converters plus the plugin's inline blocks: dates in the viewer's
 * locale and zone, read from the window when they point at it, and the scope.
 */
export const buildMessageConverters =
	(context: MessageContext): JSXConvertersFunction =>
	({ defaultConverters }) => ({
		...defaultConverters,
		inlineBlocks: {
			[DATE_BLOCK_SLUG]: ({ node }: { node: SerializedInlineBlockNode }) => {
				const fields = node.fields as DateBlockFields
				const source = fields?.source ?? 'custom'
				const iso = source === 'custom' ? (fields?.date ?? null) : context[source]
				if (iso === null) {
					return source === 'endsAt' ? <>{context.openEndLabel}</> : null
				}
				return <LocalDate format={fields?.format ?? 'datetime'} iso={iso} />
			},
			[SCOPE_BLOCK_SLUG]: () => (
				<>
					{context.scopeLabels === null ? context.everythingLabel : context.scopeLabels.join(', ')}
				</>
			),
		},
	})
