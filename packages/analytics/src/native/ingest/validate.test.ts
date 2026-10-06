import { describe, expect, it } from 'vitest'
import type { RawEventInput } from './normalizeEvent'
import { rawEventError, validateRawEvent } from './validate'

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
})

describe('validateRawEvent', () => {
	it('narrows a valid event and rejects an invalid one', () => {
		expect(validateRawEvent(raw({}))).toBe(true)
		expect(validateRawEvent(raw({ type: 'event' }))).toBe(false)
		expect(validateRawEvent(undefined)).toBe(false)
	})
})
