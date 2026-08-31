import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { auditLogs } from './index'
import { keys } from './translations'

const fakeConfig = () => ({ collections: [] }) as unknown as Config

describe('auditLogs factory', () => {
	it('returns a Payload plugin function', () => {
		expect(typeof auditLogs({})).toBe('function')
	})

	it('keeps the audit-logs collection in the schema when disabled', () => {
		const cfg = fakeConfig()
		const out = auditLogs({ disabled: true, collections: { posts: true } })(cfg) as Config
		expect(out).toBe(cfg)
		expect(out.collections?.map((c) => c.slug)).toContain('audit-logs')
	})

	it('registers no hooks on audited collections when disabled', () => {
		const cfg = { collections: [{ slug: 'posts', fields: [] }] } as unknown as Config
		const out = auditLogs({ disabled: true, collections: { posts: true } })(cfg) as Config
		const posts = out.collections?.find((c) => c.slug === 'posts')
		expect(posts?.hooks?.beforeChange ?? []).toHaveLength(0)
		expect(posts?.hooks?.afterChange ?? []).toHaveLength(0)
		// The fields still exist, which is the point: the schema does not change.
		expect(posts?.fields.map((f) => 'name' in f && f.name)).toContain('createdBy')
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
