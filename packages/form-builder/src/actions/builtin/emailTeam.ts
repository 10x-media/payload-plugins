import { keys } from '../../translations/keys'
import { resolveRecipientEntries } from '../emailRecipients'
import { buildEmailAction, type EmailActionConfig, type EmailActionOptions } from './emailAction'

type EmailTeamConfig = EmailActionConfig & { to?: string[] }

/**
 * The `emailTeam` action: its target is a `to` recipient list (`RecipientsSelect`, `string[]`) of
 * literal emails, picked department addresses, `{{field}}` tokens, or registered recipient sources,
 * resolved at send. A `to` the author never configured is a misconfiguration and throws; a configured
 * `to` that resolves empty (e.g. every source returned nothing) skips the send. Everything else
 * (from/cc/bcc/replyTo, subject, body, localization) is the shared email-action skeleton.
 */
export const buildEmailTeam = (options: EmailActionOptions) =>
	buildEmailAction<EmailTeamConfig>(options, {
		type: 'emailTeam',
		label: keys.actionEmailTeam,
		target: (recip) => recip('to', keys.actionConfigTo),
		resolveTo: async ({ config, resolve, sources, sourceArgs }) =>
			(await resolveRecipientEntries(config.to, { resolve, sources, sourceArgs })).join(', '),
		hasTarget: (config) => (Array.isArray(config.to) ? config.to.length > 0 : Boolean(config.to)),
		onMissingTo: 'throw',
	})

export const emailTeam = buildEmailTeam({ localize: true })
