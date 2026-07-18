import { describe, expect, it } from 'vitest'
import { definePollType } from './definePollType'
import { resolvePollTypes } from './pollTypeRegistry'

describe('resolvePollTypes', () => {
	it('always registers the three built-ins', () => {
		const registry = resolvePollTypes()
		expect([...registry.keys()].sort()).toEqual(['manual', 'mostVoted', 'source'])
		expect(registry.get('manual')?.resolveOutcome({} as never)).toBeUndefined()
	})

	it('adds host strategies from an array', () => {
		const runoff = definePollType({
			type: 'runoff',
			label: 'Runoff',
			resolveOutcome: () => ['ada'],
		})
		const registry = resolvePollTypes([runoff])
		expect(registry.get('runoff')).toBe(runoff)
		expect(registry.has('manual')).toBe(true)
	})

	it('adds host strategies from a record, forcing the type to the key', () => {
		const registry = resolvePollTypes({
			runoff: definePollType({ type: 'ignored', label: 'Runoff', resolveOutcome: () => undefined }),
		})
		expect(registry.get('runoff')?.type).toBe('runoff')
		expect(registry.has('ignored')).toBe(false)
	})

	it('lets a host replace a built-in by slug', () => {
		const replacement = definePollType({
			type: 'mostVoted',
			label: 'Custom most voted',
			resolveOutcome: () => ['override'],
		})
		const registry = resolvePollTypes([replacement])
		expect(registry.get('mostVoted')).toBe(replacement)
	})
})
