import type { RichTextField } from 'payload'
import { localizedIf } from '../../fields/localizedIf'
import { interpolate } from '../../recall/interpolate'
import { keys } from '../../translations/keys'
import { labelFor } from '../../translations/server'
import { resolverFor } from '../body/serializeBody'
import { defineAction } from '../defineAction'
import { buildFromField, type FromAddressesResolver } from '../fromAddresses'

type EmailTeamConfig = { to?: string; from?: string; subject?: string; body?: unknown }

/**
 * `subject` and `body` are email content and follow `localize`; `to` and `from` are addresses and
 * never do. `editor` overrides the body field's Lexical/richText editor (from the plugin's
 * `richText.editor` option). `fromAddresses`, when given (the plugin's `email.fromAddresses`
 * option), adds a `from` select sourced from the host resolver; absent, no `from` field exists and
 * every send uses the email adapter's default sender.
 */
export const buildEmailTeam = (
	localize: boolean,
	editor?: RichTextField['editor'],
	fromAddresses?: FromAddressesResolver
) =>
	defineAction<EmailTeamConfig>({
		type: 'emailTeam',
		label: keys.actionEmailTeam,
		config: [
			{ name: 'to', type: 'text', label: labelFor(keys.actionConfigTo) },
			...(fromAddresses ? [buildFromField(fromAddresses)] : []),
			{
				name: 'subject',
				type: 'text',
				label: labelFor(keys.actionConfigSubject),
				...localizedIf(localize),
			},
			{
				name: 'body',
				type: 'richText',
				label: labelFor(keys.actionConfigBody),
				admin: { description: labelFor(keys.actionConfigBodyDescription) },
				...localizedIf(localize),
				...(editor ? { editor } : {}),
			},
		],
		run: async (args) => {
			const { config, values, payload, renderBody } = args

			if (!config.to) {
				throw new Error('emailTeam: missing "to" address')
			}

			if (typeof payload.sendEmail !== 'function') {
				throw new Error('emailTeam: no email adapter configured')
			}

			const subject = interpolate(config.subject ?? '', resolverFor(values))
			const html = await renderBody(config.body)

			// `from` was validated at save time against `fromAddresses(req)`; not re-checked here
			// (the job's `req` may differ from the authoring admin's, and the config is
			// admin-authored, not visitor-controlled), so the stored value is forwarded verbatim.
			await payload.sendEmail({
				to: config.to,
				subject,
				html,
				...(config.from ? { from: config.from } : {}),
			})
		},
	})

export const emailTeam = buildEmailTeam(true)
