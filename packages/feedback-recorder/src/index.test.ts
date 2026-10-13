import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { feedbackRecorder } from './index'
import { getRegistry } from './plugin/registry'
import { keys } from './translations'

const fakeConfig = () => ({ collections: [], admin: { user: 'users' } }) as unknown as Config

const configured = { url: 'https://tenx.example', apiKey: 'rec_key' }

describe('feedbackRecorder factory', () => {
	it('returns a Payload plugin function', () => {
		expect(typeof feedbackRecorder({})).toBe('function')
	})

	it('returns the incoming config when disabled', () => {
		const cfg = fakeConfig()
		expect(feedbackRecorder({ disabled: true })(cfg)).toBe(cfg)
	})

	it('applies the translations option and ships German', () => {
		const out = feedbackRecorder({ translations: { de: { [keys.pluginName]: 'Beispiel' } } })(
			fakeConfig()
		) as Config
		const i18n = out.i18n?.translations as Record<string, Record<string, Record<string, string>>>
		expect(i18n.de?.feedbackRecorder?.pluginName).toBe('Beispiel')
		expect(i18n.de?.feedbackRecorder?.start).toBe('Aufnahme starten')
		expect(i18n.en?.feedbackRecorder?.pluginName).toBe('Feedback Recorder')
	})

	it('registers the provider, the header action and five endpoints', () => {
		const out = feedbackRecorder(configured)(fakeConfig()) as Config
		expect(out.admin?.components?.providers).toContain(
			'@10x-media/feedback-recorder/rsc#FeedbackRecorderProvider'
		)
		expect(out.admin?.components?.actions).toContain(
			'@10x-media/feedback-recorder/client#FeedbackRecorderButton'
		)
		expect(out.endpoints?.map((endpoint) => `${endpoint.method} ${endpoint.path}`)).toEqual([
			'get /feedback-recorder/status',
			'post /feedback-recorder/clips',
			'get /feedback-recorder/clips',
			'post /feedback-recorder/clips/:id/complete',
			'put /feedback-recorder/clips/:id/audio',
		])
	})

	it('leaves the header action out when asked', () => {
		const out = feedbackRecorder({ ...configured, headerAction: false })(fakeConfig()) as Config
		expect(out.admin?.components?.actions ?? []).toHaveLength(0)
	})

	it('parks the resolved options, configured or not', () => {
		const withKey = feedbackRecorder(configured)(fakeConfig()) as Config
		expect(getRegistry(withKey)?.configured).toBe(true)
		const without = feedbackRecorder({})(fakeConfig()) as Config
		expect(getRegistry(without)?.configured).toBe(false)
	})
})
