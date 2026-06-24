import { describe, expect, it } from 'vitest'
import type { FieldRenderer } from './contract'
import { resolveRenderers } from './registry'

const a: FieldRenderer = () => null
const b: FieldRenderer = () => null
const custom: FieldRenderer = () => null

describe('resolveRenderers', () => {
	it('returns the defaults when no config is given', () => {
		const map = resolveRenderers({ text: a, number: b })
		expect(map.get('text')).toBe(a)
		expect(map.get('number')).toBe(b)
	})

	it('false removes a renderer, true keeps it, an object adds or replaces', () => {
		const map = resolveRenderers(
			{ text: a, number: b },
			{ number: false, text: true, rating: custom }
		)
		expect(map.has('number')).toBe(false)
		expect(map.get('text')).toBe(a)
		expect(map.get('rating')).toBe(custom)
	})
})
