import type { LabelFunction } from 'payload'
import { describe, expect, it } from 'vitest'
import { resolveDefinitionLabel } from './server'

// A minimal stand-in for the label-function args, echoing the key so we can assert `t` was applied;
// the resolver only reads `t`, so the unused `i18n` is elided behind the parameter cast.
const args = { t: (key: string) => `t:${key}` } as unknown as Parameters<LabelFunction>[0]

describe('resolveDefinitionLabel', () => {
	it('resolves a string label through the request t, like a field label', () => {
		const label = resolveDefinitionLabel('formBuilder:action.emailTeam')
		expect(typeof label).toBe('function')
		expect((label as LabelFunction)(args)).toBe('t:formBuilder:action.emailTeam')
	})

	it('passes a per-locale record through unchanged for Payload to localize', () => {
		const record = { en: 'Notify team', de: 'Team benachrichtigen' }
		expect(resolveDefinitionLabel(record)).toBe(record)
	})
})
