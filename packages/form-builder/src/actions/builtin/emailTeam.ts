import { keys } from '../../translations/keys'
import { resolveRecipients } from '../emailRecipients'
import { buildEmailAction, type EmailActionConfig, type EmailActionOptions } from './emailAction'

type EmailTeamConfig = EmailActionConfig & { to?: string[] }

/**
 * The `emailTeam` action: its target is a `to` recipient list (`RecipientsSelect`, `string[]`) of
 * literal emails, picked department addresses, or `{{field}}` tokens resolved from the submission at
 * send. An empty `to` is a misconfiguration and throws. Everything else (from/cc/bcc/replyTo, subject,
 * body, localization) is the shared email-action skeleton.
 */
export const buildEmailTeam = (options: EmailActionOptions) =>
	buildEmailAction<EmailTeamConfig>(options, {
		type: 'emailTeam',
		label: keys.actionEmailTeam,
		target: (recip) => recip('to', keys.actionConfigTo),
		resolveTo: (config, resolve) => resolveRecipients(config.to, resolve),
		onMissingTo: 'throw',
	})

export const emailTeam = buildEmailTeam({ localize: true })
