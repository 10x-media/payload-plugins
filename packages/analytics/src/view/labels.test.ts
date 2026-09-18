import { describe, expect, it } from 'vitest'
import { TRAFFIC_CHANNELS } from '../native/ingest/source'
import { keys } from '../translations/keys'
import type { Translate } from '../translations/server'
import { CHANNEL_LABELS, valueLabel } from './labels'

const t: Translate = (key) => `t(${key})`

const native = (dimension: Parameters<typeof valueLabel>[0]['dimension'], value: string): string =>
	valueLabel({ dimension, value, provider: 'native', t })

describe('valueLabel', () => {
	it('names every traffic channel the native channel dimension can hold', () => {
		for (const channel of TRAFFIC_CHANNELS) {
			expect(native('channel', channel)).toBe(`t(${CHANNEL_LABELS[channel]})`)
		}
	})

	it('translates a channel through its own key', () => {
		expect(native('channel', 'organic-search')).toBe(`t(${keys.channelOrganicSearch})`)
	})

	it('names the direct source, which is the one origin that is not a name', () => {
		expect(native('source', 'direct')).toBe(`t(${keys.channelDirect})`)
	})

	it('reads a host or a campaign tag under source as it was stored', () => {
		expect(native('source', 'google.com')).toBe('google.com')
		// A `utm_source` reading `email` is the tag, not the Email channel.
		expect(native('source', 'email')).toBe('email')
	})

	it('answers a prototype member name as itself', () => {
		expect(native('channel', 'constructor')).toBe('constructor')
		expect(native('channel', '__proto__')).toBe('__proto__')
		expect(native('source', 'constructor')).toBe('constructor')
	})

	it("leaves a provider's own vocabulary raw on both dimensions", () => {
		expect(valueLabel({ dimension: 'source', value: 'direct', provider: 'plausible', t })).toBe(
			'direct'
		)
		expect(valueLabel({ dimension: 'channel', value: 'Paid Search', provider: 'ga4', t })).toBe(
			'Paid Search'
		)
	})

	it('names an empty value on any dimension and any source', () => {
		expect(native('channel', '')).toBe(`t(${keys.valueNotSet})`)
		expect(native('source', '   ')).toBe(`t(${keys.valueNotSet})`)
		expect(valueLabel({ dimension: 'channel', value: '', provider: 'posthog', t })).toBe(
			`t(${keys.valueNotSet})`
		)
		expect(valueLabel({ dimension: 'page', value: '\t', provider: 'plausible', t })).toBe(
			`t(${keys.valueNotSet})`
		)
	})

	it('leaves every other dimension raw', () => {
		expect(native('referrer', 'direct')).toBe('direct')
		expect(native('page', '/pricing')).toBe('/pricing')
		expect(native('utmMedium', 'email')).toBe('email')
	})
})
