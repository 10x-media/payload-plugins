import { interpolate } from '../../recall/interpolate'
import { keys } from '../../translations/keys'
import { labelFor } from '../../translations/server'
import { resolverFor } from '../body/serializeBody'
import { defineAction } from '../defineAction'

type ConfirmationConfig = { toField?: string; subject?: string; body?: unknown }

export const confirmation = defineAction<ConfirmationConfig>({
	type: 'confirmation',
	label: keys.actionConfirmation,
	config: [
		{ name: 'toField', type: 'text', label: labelFor(keys.actionConfigToField) },
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

		if (!config.toField) {
			return
		}

		const resolve = resolverFor(values)
		const to = resolve(config.toField)

		if (!to) {
			return
		}

		if (typeof payload.sendEmail !== 'function') {
			throw new Error('confirmation: no email adapter configured')
		}

		const subject = interpolate(config.subject ?? '', resolve)
		const html = await renderBody(config.body)

		await payload.sendEmail({ to, subject, html })
	},
})
