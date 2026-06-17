import { keys } from '../../translations/keys'
import { labelFor } from '../../translations/server'
import { defineAction } from '../defineAction'
import { SIGNATURE_HEADER, signPayload } from '../sign'

type SignedWebhookConfig = { url?: string; secret?: string }

export const signedWebhook = defineAction<SignedWebhookConfig>({
	type: 'signedWebhook',
	label: keys.actionSignedWebhook,
	config: [
		{ name: 'url', type: 'text', label: labelFor(keys.actionConfigUrl) },
		{ name: 'secret', type: 'text', label: labelFor(keys.actionConfigSecret) },
	],
	run: async (args) => {
		const { config, form, submissionId, values } = args

		if (!config.url) {
			throw new Error('signedWebhook: missing "url"')
		}
		if (!config.secret) {
			throw new Error('signedWebhook: missing "secret"')
		}

		const body = JSON.stringify({ formId: form.id, submissionId, values })
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), 10_000)

		let response: Response
		try {
			response = await fetch(config.url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					[SIGNATURE_HEADER]: signPayload(body, config.secret),
				},
				body,
				signal: controller.signal,
			})
		} finally {
			clearTimeout(timer)
		}

		if (!response.ok) {
			throw new Error(`signedWebhook: server responded ${response.status}`)
		}
	},
})
