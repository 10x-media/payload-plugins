import type { RichTextField } from 'payload'
import type { AnyActionDefinition } from '../defineAction'
import type { FromAddressesResolver } from '../fromAddresses'
import { buildConfirmation } from './confirmation'
import { buildEmailTeam } from './emailTeam'
import { signedWebhook } from './signedWebhook'

/**
 * Built-in action definitions with content-bearing config fields (email subjects and rich text
 * bodies) carrying `localized: true` when `localize` is true. `editor`, when given, overrides
 * the Lexical/richText editor on both action bodies (the plugin passes
 * `richText.bodyEditor ?? richText.editor`). `fromAddresses`, when given (the plugin's
 * `email.fromAddresses` option), adds a `from` select to both email actions. `signedWebhook` has
 * no content fields and is shared static.
 */
export const buildDefaultActionDefinitions = (
	localize: boolean,
	editor?: RichTextField['editor'],
	fromAddresses?: FromAddressesResolver
): Record<string, AnyActionDefinition> => ({
	emailTeam: buildEmailTeam(localize, editor, fromAddresses) as AnyActionDefinition,
	confirmation: buildConfirmation(localize, editor, fromAddresses) as AnyActionDefinition,
	signedWebhook: signedWebhook as AnyActionDefinition,
})

/**
 * Prebuilt with content localization on; with `localizeContent: false`, derive overrides from
 * `buildDefaultActionDefinitions(false)` instead so a spread does not reintroduce `localized`.
 */
export const defaultActionDefinitions: Record<string, AnyActionDefinition> =
	buildDefaultActionDefinitions(true)
