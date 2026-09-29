import type { SerializedInlineBlockNode } from '@payloadcms/richtext-lexical'
import type { JSXConvertersFunction } from '@payloadcms/richtext-lexical/react'

import { DATE_BLOCK_SLUG, type DateFormat } from '../lexical/dateBlock'
import { LocalDate } from './LocalDate'

type DateBlockFields = { date?: string; format?: DateFormat }

/** Default converters plus the inline date, rendered in the viewer's locale and zone. */
export const messageConverters: JSXConvertersFunction = ({ defaultConverters }) => ({
	...defaultConverters,
	inlineBlocks: {
		[DATE_BLOCK_SLUG]: ({ node }: { node: SerializedInlineBlockNode }) => {
			const fields = node.fields as DateBlockFields
			return fields?.date ? (
				<LocalDate format={fields.format ?? 'datetime'} iso={fields.date} />
			) : null
		},
	},
})
