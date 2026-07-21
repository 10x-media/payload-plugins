import { describe, expect, it } from 'vitest'
import { buildActionBlocks } from './buildActionBlocks'
import { defaultActionDefinitions } from './builtin'
import { resolveActions } from './registry'

describe('buildActionBlocks', () => {
	const registry = resolveActions(defaultActionDefinitions)
	const blocks = buildActionBlocks(registry)

	it('builds one block per registered action type', () => {
		expect(blocks.map((b) => b.slug)).toEqual(['emailTeam', 'confirmation', 'signedWebhook'])
	})

	it('sets block fields from definition.config (recipient fields nest in rows)', () => {
		const emailBlock = blocks.find((b) => b.slug === 'emailTeam')
		const flat = (emailBlock?.fields ?? []).flatMap((f) => (f.type === 'row' ? f.fields : [f]))
		const names = flat.map((f) => ('name' in f ? f.name : undefined))
		expect(names).toContain('to')
		expect(names).toContain('subject')
		expect(names).toContain('body')
	})

	it('returns empty array for empty registry', () => {
		expect(buildActionBlocks(new Map())).toEqual([])
	})

	it('block with no config has empty fields', () => {
		const noConfigRegistry = resolveActions({
			bare: { type: 'bare', label: 'Bare', run: async () => undefined },
		})
		const result = buildActionBlocks(noConfigRegistry)
		expect(result[0]?.fields).toEqual([])
	})
})
