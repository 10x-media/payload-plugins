import type { PayloadRequest } from 'payload'

import type { CollectionContext, PluginContext } from '../plugin/context'
import type { LoadedDoc } from './load'
import { completeIn } from './plan'
import { draftLocales } from './status'

/**
 * The locale the values every locale shares are written in: the one `requested` names when
 * the config has it, then the default one when the survivor holds every value Payload
 * requires there, then the first such locale, then the default one. Only among the `usable`
 * ones while there is one: a write in a locale the survivor is a draft in would save the
 * shared values as a draft of every locale.
 */
export const pickWriteLocale = ({
	locales,
	defaultLocale,
	requested,
	complete,
	usable = () => true,
}: {
	locales: readonly string[]
	defaultLocale: string
	requested: string | null | undefined
	/** Whether the survivor holds every value Payload requires in a locale. */
	complete: (locale: string) => boolean
	usable?: (locale: string) => boolean
}): string => {
	const candidates = locales.some(usable) ? locales.filter(usable) : locales
	if (requested && candidates.includes(requested)) return requested
	if (candidates.includes(defaultLocale) && complete(defaultLocale)) return defaultLocale
	return (
		candidates.find(complete) ??
		(candidates.includes(defaultLocale) ? defaultLocale : (candidates[0] ?? defaultLocale))
	)
}

/** The write locale of a merge into `survivor`; null without localization. */
export const resolveWriteLocale = async (args: {
	req: PayloadRequest
	ctx: PluginContext
	col: CollectionContext
	survivor: LoadedDoc
}): Promise<string | null> => {
	const { req, ctx, col, survivor } = args
	if (!ctx.localeCodes || !ctx.defaultLocale) return null
	const option = col.options.writeLocale
	const requested = typeof option === 'function' ? await option({ req, survivor }) : option
	const schema = { fields: col.config.flattenedFields, blocks: req.payload.config.blocks }
	const drafts = draftLocales(col, survivor, ctx.localeCodes)
	return pickWriteLocale({
		locales: ctx.localeCodes,
		defaultLocale: ctx.defaultLocale,
		requested,
		complete: (locale) => completeIn(survivor, locale, schema),
		usable: (locale) => !drafts.includes(locale),
	})
}
