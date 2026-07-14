import type { AnyActionDefinition } from '../defineAction'
import { buildConfirmation } from './confirmation'
import { buildEmailTeam } from './emailTeam'
import { signedWebhook } from './signedWebhook'

/**
 * Built-in action definitions with content-bearing config fields (email subjects and rich text
 * bodies) carrying `localized: true` when `localize` is true. `signedWebhook` has no content
 * fields and is shared static.
 */
export const buildDefaultActionDefinitions = (
	localize: boolean
): Record<string, AnyActionDefinition> => ({
	emailTeam: buildEmailTeam(localize) as AnyActionDefinition,
	confirmation: buildConfirmation(localize) as AnyActionDefinition,
	signedWebhook: signedWebhook as AnyActionDefinition,
})

/**
 * Prebuilt with content localization on; with `localizeContent: false`, derive overrides from
 * `buildDefaultActionDefinitions(false)` instead so a spread does not reintroduce `localized`.
 */
export const defaultActionDefinitions: Record<string, AnyActionDefinition> =
	buildDefaultActionDefinitions(true)
