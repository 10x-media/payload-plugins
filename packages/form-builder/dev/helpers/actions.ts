import { defineAction } from '../../src/actions/defineAction'

type ForwardConfig = { url?: string; method?: string }

export const forwardAction = defineAction<ForwardConfig>({
	type: 'forward',
	label: 'Forward to API',
	config: [
		{ name: 'url', type: 'text', required: true, label: 'Target URL' },
		{
			name: 'method',
			type: 'select',
			defaultValue: 'POST',
			options: [
				{ label: 'POST', value: 'POST' },
				{ label: 'PUT', value: 'PUT' },
			],
			label: 'HTTP method',
		},
	],
	run: async ({ config, form, submissionId, values }) => {
		if (!config.url) {
			throw new Error('forward: missing "url"')
		}

		const body = JSON.stringify({
			formId: form.id,
			submissionId,
			values,
		})

		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), 10_000)

		try {
			const res = await fetch(config.url, {
				method: config.method ?? 'POST',
				headers: { 'Content-Type': 'application/json' },
				body,
				signal: controller.signal,
			})

			if (!res.ok) {
				throw new Error(`forward: server responded ${res.status}`)
			}
		} finally {
			clearTimeout(timer)
		}
	},
})
