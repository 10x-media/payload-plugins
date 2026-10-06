import type { JSXConverters, JSXConvertersFunction } from '@payloadcms/richtext-lexical/react'
import type { ReactNode } from 'react'

import {
	type SerializedTokenNode,
	TEXT_FORMAT_BITS,
	TOKEN_NODE_TYPE,
	tokenDataOf,
} from '../lexical/token/types'
import { LocalDate } from './LocalDate'

const tokenClass = 'content-lock-banner__token'

/** Wrap a rendered token in the text format it carries, as Lexical renders text. */
const withTextFormat = (textFormat: number, content: ReactNode): ReactNode => {
	let out = content
	if (textFormat & TEXT_FORMAT_BITS.bold) out = <strong>{out}</strong>
	if (textFormat & TEXT_FORMAT_BITS.italic) out = <em>{out}</em>
	if (textFormat & TEXT_FORMAT_BITS.underline) out = <u>{out}</u>
	if (textFormat & TEXT_FORMAT_BITS.strikethrough) out = <s>{out}</s>
	return out
}

/** The window a message belongs to, as its tokens read it. */
export type MessageContext = {
	startsAt: string
	/** `null` when the window ends manually. */
	endsAt: string | null
	announceAt: string | null
	/** Scope labels in the viewer's language, or `null` for everything. */
	scopeLabels: string[] | null
	/**
	 * The content locale the message was loaded in, so its dates read in the
	 * message's language rather than the admin's. `undefined` without
	 * localization.
	 */
	locale: string | undefined
}

/**
 * Default converters plus lock value tokens: dates in the viewer's locale and
 * zone, read from the window unless fixed, and the scope, each in its own
 * bold, italic, underline or strikethrough. A token the window cannot fill
 * (flagged on its chip in the editor) renders as nothing.
 */
export const buildMessageConverters =
	(context: MessageContext): JSXConvertersFunction =>
	({ defaultConverters }) => ({
		...defaultConverters,
		[TOKEN_NODE_TYPE]: ({ node }: { node: SerializedTokenNode }) => {
			const data = tokenDataOf(node)
			if (data.token === 'scope') {
				return context.scopeLabels === null
					? null
					: withTextFormat(
							data.textFormat,
							<span className={tokenClass}>{context.scopeLabels.join(', ')}</span>
						)
			}
			const iso = data.token === 'date' ? (data.date ?? null) : context[data.token]
			return iso === null
				? null
				: withTextFormat(
						data.textFormat,
						<LocalDate
							className={tokenClass}
							format={data.format}
							iso={iso}
							language={context.locale}
						/>
					)
		},
	})

/**
 * The plugin's converters with a project's on top: the project's function
 * receives the plugin's map as its `defaultConverters`, so it can extend or
 * replace any of them, the tokens included.
 */
export const composeConverters =
	(ours: JSXConvertersFunction, theirs: JSXConvertersFunction | undefined): JSXConvertersFunction =>
	(args) => {
		const base: JSXConverters = ours(args)
		return theirs ? theirs({ defaultConverters: base }) : base
	}
