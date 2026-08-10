import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { auditLogs } from './index'
import { keys } from './translations'

const fakeConfig = () => ({ collections: [] }) as unknown as Config

describe('auditLogs factory', () => {
	it('returns a Payload plugin function', () => {
		expect(typeof auditLogs({})).toBe('function')
	})

	it('returns the incoming config when disabled', () => {
		const cfg = fakeConfig()
		expect(auditLogs({ disabled: true })(cfg)).toBe(cfg)
	})

	it('applies the translations option', () => {
		const out = auditLogs({ translations: { de: { [keys.pluginName]: 'Beispiel' } } })(
			fakeConfig()
		) as Config
		const i18n = out.i18n?.translations as Record<string, Record<string, Record<string, string>>>
		expect(i18n.de?.auditLogs?.pluginName).toBe('Beispiel')
		expect(i18n.en?.auditLogs?.pluginName).toBe('Audit Logs')
	})
})
