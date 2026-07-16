import type { RichTextField } from 'payload'
import type { AnyActionDefinition } from '../defineAction'
import { buildConfirmation } from './confirmation'
import { buildEmailTeam } from './emailTeam'
import { signedWebhook } from './signedWebhook'

/**
 * Built-in action definitions with content-bearing config fields (email subjects and rich text
 * bodies) carrying `localized: true` when `localize` is true. `editor`, when given, overrides
 * the Lexical/richText editor on both action bodies (the plugin passes
 * `richText.bodyEditor ?? richText.editor`). `signedWebhook` has no content fields and is
 * shared static.
 */
export const buildDefaultActionDefinitions = (
	localize: boolean,
	editor?: RichTextField['editor']
): Record<string, AnyActionDefinition> => ({
	emailTeam: buildEmailTeam(localize, editor) as AnyActionDefinition,
	confirmation: buildConfirmation(localize, editor) as AnyActionDefinition,
	signedWebhook: signedWebhook as AnyActionDefinition,
})

/**
 * Prebuilt with content localization on; with `localizeContent: false`, derive overrides from
 * `buildDefaultActionDefinitions(false)` instead so a spread does not reintroduce `localized`.
 */
export const defaultActionDefinitions: Record<string, AnyActionDefinition> =
	buildDefaultActionDefinitions(true)
