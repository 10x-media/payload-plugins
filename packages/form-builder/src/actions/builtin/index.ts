import type { RichTextField } from 'payload'
import type { DepartmentEmailsResolver } from '../../email/departments'
import type { AnyActionDefinition } from '../defineAction'
import type { RecipientsConfig } from '../emailRecipients'
import type { FromAddressesResolver } from '../fromAddresses'
import { buildConfirmation } from './confirmation'
import { buildEmailTeam } from './emailTeam'
import { signedWebhook } from './signedWebhook'

/**
 * Built-in action definitions with content-bearing config fields (email subjects and rich text
 * bodies) carrying `localized: true` when `localize` is true. `editor`, when given, overrides
 * the Lexical/richText editor on both action bodies (the plugin passes
 * `richText.bodyEditor ?? richText.editor`). `fromAddresses`, when given (the plugin's
 * `email.fromAddresses` option), adds a `from` select to both email actions. `departments`, when
 * given (the plugin's `email.departments` option), turns the `emailTeam` `to` into a select over the
 * host's resolved departments. `signedWebhook` has no content fields and is shared static.
 */
// biome-ignore lint/complexity/useMaxParams: positional args thread the plugin editor and email options (localize, editor, fromAddresses, departments, recipients)
export const buildDefaultActionDefinitions = (
	localize: boolean,
	editor?: RichTextField['editor'],
	fromAddresses?: FromAddressesResolver,
	departments?: DepartmentEmailsResolver,
	recipients?: RecipientsConfig
): Record<string, AnyActionDefinition> => ({
	emailTeam: buildEmailTeam(
		localize,
		editor,
		fromAddresses,
		departments,
		recipients
	) as AnyActionDefinition,
	confirmation: buildConfirmation(
		localize,
		editor,
		fromAddresses,
		departments,
		recipients
	) as AnyActionDefinition,
	signedWebhook: signedWebhook as AnyActionDefinition,
})

/**
 * Prebuilt with content localization on; with `localizeContent: false`, derive overrides from
 * `buildDefaultActionDefinitions(false)` instead so a spread does not reintroduce `localized`.
 */
export const defaultActionDefinitions: Record<string, AnyActionDefinition> =
	buildDefaultActionDefinitions(true)
