import type { PayloadRequest } from 'payload'

import type { CollectionContext, PluginContext } from '../plugin/context'
import type { LoadedDoc } from './load'
import { completeIn } from './plan'

/**
 * The locale the values every locale shares are written in: the one `requested` names when
 * the config has it, then the default one when the survivor holds every value Payload
 * requires there, then the first such locale, then the default one.
 */
export const pickWriteLocale = ({
	locales,
	defaultLocale,
	requested,
	complete,
}: {
	locales: readonly string[]
	defaultLocale: string
	requested: string | null | undefined
	/** Whether the survivor holds every value Payload requires in a locale. */
	complete: (locale: string) => boolean
}): string => {
	if (requested && locales.includes(requested)) return requested
	if (complete(defaultLocale)) return defaultLocale
	return locales.find(complete) ?? defaultLocale
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
	return pickWriteLocale({
		locales: ctx.localeCodes,
		defaultLocale: ctx.defaultLocale,
		requested,
		complete: (locale) => completeIn(survivor, locale, schema),
	})
}
