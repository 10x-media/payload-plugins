import { describe, expect, it } from 'vitest'
import { definePollOptionSource } from './definePollOptionSource'
import { resolvePollOptionSources } from './registry'

const athletes = definePollOptionSource({
	type: 'athletes',
	label: 'Athletes',
	resolve: () => [{ label: 'Ada', value: 'ada' }],
})

describe('resolvePollOptionSources', () => {
	it('starts empty with no config (no built-in sources)', () => {
		expect(resolvePollOptionSources().size).toBe(0)
		expect(resolvePollOptionSources({}).size).toBe(0)
	})

	it('adds a definition under its config key', () => {
		const registry = resolvePollOptionSources({ athletes })
		expect(registry.get('athletes')).toMatchObject(athletes)
		expect(registry.size).toBe(1)
	})

	it('forces the definition type to the config key, so authoring and lookup agree', () => {
		const custom = definePollOptionSource({ type: 'wrong', label: 'X', resolve: () => [] })
		const registry = resolvePollOptionSources({ correct: custom })
		expect(registry.get('correct')?.type).toBe('correct')
	})

	it('treats true and false as no-ops against the empty default set', () => {
		const registry = resolvePollOptionSources({ athletes: true, other: false })
		expect(registry.size).toBe(0)
	})

	it('false removes nothing else; a later definition still registers', () => {
		const registry = resolvePollOptionSources({ removed: false, athletes })
		expect(registry.size).toBe(1)
		expect(registry.has('athletes')).toBe(true)
	})
})
