import { localizedIf } from '../../fields/localizedIf'
import { interpolate } from '../../recall/interpolate'
import { keys } from '../../translations/keys'
import { labelFor } from '../../translations/server'
import { resolverFor } from '../body/serializeBody'
import { defineAction } from '../defineAction'

type EmailTeamConfig = { to?: string; subject?: string; body?: unknown }

/** `subject` and `body` are email content and follow `localize`; the `to` address never does. */
export const buildEmailTeam = (localize: boolean) =>
	defineAction<EmailTeamConfig>({
		type: 'emailTeam',
		label: keys.actionEmailTeam,
		config: [
			{ name: 'to', type: 'text', label: labelFor(keys.actionConfigTo) },
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

			await payload.sendEmail({ to: config.to, subject, html })
		},
	})

export const emailTeam = buildEmailTeam(true)
