import { interpolate } from '../../recall/interpolate'
import { keys } from '../../translations/keys'
import { labelFor } from '../../translations/server'
import { defineAction } from '../defineAction'

type ConfirmationConfig = { toField?: string; subject?: string; body?: string }

export const confirmation = defineAction<ConfirmationConfig>({
	type: 'confirmation',
	label: keys.actionConfirmation,
	config: [
		{ name: 'toField', type: 'text', label: labelFor(keys.actionConfigToField) },
		{ name: 'subject', type: 'text', label: labelFor(keys.actionConfigSubject) },
		{ name: 'body', type: 'textarea', label: labelFor(keys.actionConfigBody) },
	],
	run: async (args) => {
		const { config, values, payload } = args

		if (!config.toField) {
			return
		}

		const entry = values.find((v) => v.field === config.toField)
		const to = entry == null ? '' : String(entry.value ?? '')

		if (!to) {
			return
		}

		if (typeof payload.sendEmail !== 'function') {
			throw new Error('confirmation: no email adapter configured')
		}

		const resolve = (name: string) => {
			const found = values.find((v) => v.field === name)
			return found == null ? '' : String(found.value ?? '')
		}

		const subject = interpolate(config.subject ?? '', resolve)
		const html = interpolate(config.body ?? '', resolve)

		await payload.sendEmail({ to, subject, html })
	},
})
