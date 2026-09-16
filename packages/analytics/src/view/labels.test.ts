import { describe, expect, it } from 'vitest'
import { TRAFFIC_CHANNELS } from '../native/ingest/source'
import { keys } from '../translations/keys'
import type { Translate } from '../translations/server'
import { CHANNEL_LABELS, valueLabel } from './labels'

const t: Translate = (key) => `t(${key})`

const native = (dimension: Parameters<typeof valueLabel>[0]['dimension'], value: string): string =>
	valueLabel({ dimension, value, provider: 'native', t })

describe('valueLabel', () => {
	it('names every traffic channel the native source dimension can hold', () => {
		for (const channel of TRAFFIC_CHANNELS) {
			expect(native('source', channel)).toBe(`t(${CHANNEL_LABELS[channel]})`)
		}
	})

	it('translates a channel through its own key', () => {
		expect(native('source', 'search')).toBe(`t(${keys.channelSearch})`)
	})

	it('reads a legacy host row under source as it was stored', () => {
		expect(native('source', 'google.com')).toBe('google.com')
	})

	it('answers a prototype member name as itself', () => {
		expect(native('source', 'constructor')).toBe('constructor')
		expect(native('source', '__proto__')).toBe('__proto__')
	})

	it('leaves a provider source row raw, since it is a utm_source and not a channel', () => {
		expect(valueLabel({ dimension: 'source', value: 'email', provider: 'plausible', t })).toBe(
			'email'
		)
		expect(valueLabel({ dimension: 'source', value: 'search', provider: 'ga4', t })).toBe('search')
	})

	it('leaves every other dimension raw', () => {
		expect(native('referrer', 'search')).toBe('search')
		expect(native('page', '/pricing')).toBe('/pricing')
		expect(native('utmMedium', 'email')).toBe('email')
	})
})
