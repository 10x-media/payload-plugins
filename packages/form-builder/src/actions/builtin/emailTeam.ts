import { interpolate } from '../../recall/interpolate'
import { keys } from '../../translations/keys'
import { labelFor } from '../../translations/server'
import { resolverFor } from '../body/serializeBody'
import { defineAction } from '../defineAction'

type EmailTeamConfig = { to?: string; subject?: string; body?: unknown }

export const emailTeam = defineAction<EmailTeamConfig>({
	type: 'emailTeam',
	label: keys.actionEmailTeam,
	config: [
		{ name: 'to', type: 'text', label: labelFor(keys.actionConfigTo) },
		{ name: 'subject', type: 'text', label: labelFor(keys.actionConfigSubject) },
		{
			name: 'body',
			type: 'richText',
			label: labelFor(keys.actionConfigBody),
			admin: { description: labelFor(keys.actionConfigBodyDescription) },
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
