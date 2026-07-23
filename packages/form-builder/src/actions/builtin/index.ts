import type { AnyActionDefinition } from '../defineAction'
import { buildConfirmation } from './confirmation'
import type { EmailActionOptions } from './emailAction'
import { buildEmailTeam } from './emailTeam'
import { signedWebhook } from './signedWebhook'

/**
 * Built-in action definitions with content-bearing config fields (email subjects and rich text
 * bodies) carrying `localized: true` when `options.localize` is true. `options.editor`, when given,
 * overrides the Lexical/richText editor on both action bodies (the plugin passes
 * `richText.bodyEditor ?? richText.editor`). `options.fromAddresses` (the plugin's
 * `email.fromAddresses` option) adds a `from` select to both email actions. `options.departments`
 * (the plugin's `email.departments` option) turns the recipient selects into pickers over the host's
 * resolved departments. `signedWebhook` has no content fields and is shared static.
 */
export const buildDefaultActionDefinitions = (
	options: EmailActionOptions
): Record<string, AnyActionDefinition> => ({
	emailTeam: buildEmailTeam(options) as AnyActionDefinition,
	confirmation: buildConfirmation(options) as AnyActionDefinition,
	signedWebhook: signedWebhook as AnyActionDefinition,
})

/**
 * Prebuilt with content localization on; with `localizeContent: false`, derive overrides from
 * `buildDefaultActionDefinitions({ localize: false })` instead so a spread does not reintroduce `localized`.
 */
export const defaultActionDefinitions: Record<string, AnyActionDefinition> =
	buildDefaultActionDefinitions({ localize: true })
