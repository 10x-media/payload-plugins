import { describe, expect, it } from 'vitest'
import type { RawEventInput } from './normalizeEvent'
import { boundedSinceMs, isNavigation, rawEventError } from './validate'

const raw = (over: Record<string, unknown>): RawEventInput =>
	({ type: 'pageview', path: '/p', hostname: 'h', ...over }) as RawEventInput

describe('rawEventError', () => {
	it('accepts a pageview without a name', () => {
		expect(rawEventError(raw({}))).toBeUndefined()
	})

	it('accepts an event and a goal carrying a name', () => {
		expect(rawEventError(raw({ type: 'event', name: 'signup' }))).toBeUndefined()
		expect(rawEventError(raw({ type: 'goal', name: 'purchase' }))).toBeUndefined()
	})

	it('accepts an engagement without a name, whatever its time and scroll hold', () => {
		expect(rawEventError(raw({ type: 'engagement', durationMs: 4000 }))).toBeUndefined()
		expect(rawEventError(raw({ type: 'engagement', durationMs: -1, scrollDepth: 'deep' }))).toBe(
			undefined
		)
	})

	it('names type for a missing body and an unknown type', () => {
		expect(rawEventError(undefined)).toBe('type')
		expect(rawEventError(raw({ type: 'nope' }))).toBe('type')
		expect(rawEventError(raw({ type: 7 }))).toBe('type')
	})

	it('names path for a missing, empty, or non-string path', () => {
		expect(rawEventError(raw({ path: undefined }))).toBe('path')
		expect(rawEventError(raw({ path: '' }))).toBe('path')
		expect(rawEventError(raw({ path: {} }))).toBe('path')
		expect(rawEventError(raw({ path: ['/p'] }))).toBe('path')
	})

	it('accepts a missing hostname and names it for a non-string one', () => {
		expect(rawEventError(raw({ hostname: undefined }))).toBeUndefined()
		expect(rawEventError(raw({ hostname: 7 }))).toBe('hostname')
		expect(rawEventError(raw({ hostname: {} }))).toBe('hostname')
	})

	it('demands a hostname where the caller supplies its own', () => {
		expect(rawEventError(raw({ hostname: undefined }), { requireHostname: true })).toBe('hostname')
		expect(rawEventError(raw({ hostname: '' }), { requireHostname: true })).toBe('hostname')
		expect(rawEventError(raw({}), { requireHostname: true })).toBeUndefined()
	})

	it('names name for an event or goal without one', () => {
		expect(rawEventError(raw({ type: 'event' }))).toBe('name')
		expect(rawEventError(raw({ type: 'goal' }))).toBe('name')
		expect(rawEventError(raw({ type: 'goal', name: {} }))).toBe('name')
	})

	it('reports the first failing field, type before path', () => {
		expect(rawEventError(raw({ type: 'nope', path: '' }))).toBe('type')
	})

	// Revenue semantics are server-only: a body carrying them is a forgery attempt, and a
	// forged refund would subtract from a bucket it never added to, permanently.
	it('refuses a revenue flag and a negative value on the wire', () => {
		expect(rawEventError(raw({ type: 'goal', name: 'purchase', revenue: true }))).toBe('revenue')
		expect(rawEventError(raw({ type: 'goal', name: 'purchase', value: -49 }))).toBe('value')
	})

	it('allows both where the caller is server code', () => {
		const refund = raw({ type: 'goal', name: 'purchase', revenue: true, value: -49 })
		expect(rawEventError(refund, { allowRevenue: true })).toBeUndefined()
	})

	it('leaves a non-negative value and an absent flag alone', () => {
		expect(rawEventError(raw({ type: 'goal', name: 'purchase', value: 49 }))).toBeUndefined()
		expect(rawEventError(raw({ type: 'goal', name: 'purchase', revenue: false }))).toBeUndefined()
	})
})

describe('boundedSinceMs', () => {
	it('keeps whole milliseconds from zero to a day', () => {
		expect(boundedSinceMs(0)).toBe(0)
		expect(boundedSinceMs(60_000)).toBe(60_000)
		expect(boundedSinceMs(1234.4)).toBe(1234)
		expect(boundedSinceMs(86_400_000)).toBe(86_400_000)
	})

	it('believes nothing below zero, past a day, or that is not a finite number', () => {
		for (const value of [-1, 86_400_001, Number.NaN, Number.POSITIVE_INFINITY, '5', null, {}]) {
			expect(boundedSinceMs(value)).toBeUndefined()
		}
	})
})

describe('isNavigation', () => {
	it('reads `1` alone as a navigation', () => {
		expect(isNavigation(1)).toBe(true)
		for (const value of [0, 2, '1', true, null, undefined]) {
			expect(isNavigation(value)).toBe(false)
		}
	})
})
