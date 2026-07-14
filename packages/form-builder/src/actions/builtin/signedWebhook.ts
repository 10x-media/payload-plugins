import type { PayloadRequest } from 'payload'
import { keys } from '../../translations/keys'
import { asTranslate, labelFor } from '../../translations/server'
import { defineAction } from '../defineAction'
import { SIGNATURE_HEADER, signPayload } from '../sign'

type SignedWebhookConfig = { url?: string; secret?: string }

/**
 * Validates the signed-webhook action's `url`: unset is fine (the runtime throws on a missing
 * URL when the action actually runs), otherwise it must parse as an absolute http(s) URL.
 * Exported for unit testing.
 */
export const validateUrl = (
	value: unknown,
	{ req }: { data?: unknown; req: PayloadRequest }
): string | true => {
	if (typeof value !== 'string' || value.length === 0) {
		return true
	}
	let parsed: URL
	try {
		parsed = new URL(value)
	} catch {
		return asTranslate(req.t)(keys.validationUrlInvalid)
	}
	return parsed.protocol === 'http:' || parsed.protocol === 'https:'
		? true
		: asTranslate(req.t)(keys.validationUrlInvalid)
}

export const signedWebhook = defineAction<SignedWebhookConfig>({
	type: 'signedWebhook',
	label: keys.actionSignedWebhook,
	config: [
		{
			name: 'url',
			type: 'text',
			label: labelFor(keys.actionConfigUrl),
			admin: { description: labelFor(keys.actionConfigUrlDescription) },
			validate: validateUrl,
		},
		{
			name: 'secret',
			type: 'text',
			label: labelFor(keys.actionConfigSecret),
			admin: { description: labelFor(keys.actionConfigSecretDescription) },
		},
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
