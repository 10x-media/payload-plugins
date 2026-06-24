import { interpolate } from '../../recall/interpolate'
import { keys } from '../../translations/keys'
import { labelFor } from '../../translations/server'
import { defineAction } from '../defineAction'

type EmailTeamConfig = { to?: string; subject?: string; body?: string }

export const emailTeam = defineAction<EmailTeamConfig>({
	type: 'emailTeam',
	label: keys.actionEmailTeam,
	config: [
		{ name: 'to', type: 'text', label: labelFor(keys.actionConfigTo) },
		{ name: 'subject', type: 'text', label: labelFor(keys.actionConfigSubject) },
		{ name: 'body', type: 'textarea', label: labelFor(keys.actionConfigBody) },
	],
	run: async (args) => {
		const { config, values, payload } = args

		if (!config.to) {
			throw new Error('emailTeam: missing "to" address')
		}

		if (typeof payload.sendEmail !== 'function') {
			throw new Error('emailTeam: no email adapter configured')
		}

		const resolve = (name: string) => {
			const entry = values.find((v) => v.field === name)
			return entry == null ? '' : String(entry.value ?? '')
		}

		const subject = interpolate(config.subject ?? '', resolve)
		const html = interpolate(config.body ?? '', resolve)

		await payload.sendEmail({ to: config.to, subject, html })
	},
})
