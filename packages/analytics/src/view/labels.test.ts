import { describe, expect, it } from 'vitest'
import { TRAFFIC_CHANNELS } from '../native/ingest/source'
import { keys } from '../translations/keys'
import type { Translate } from '../translations/server'
import { CHANNEL_LABELS, valueLabel } from './labels'

const t: Translate = (key) => `t(${key})`

describe('valueLabel', () => {
	it('names every traffic channel the source dimension can hold', () => {
		for (const channel of TRAFFIC_CHANNELS) {
			expect(valueLabel('source', channel, t)).toBe(`t(${CHANNEL_LABELS[channel]})`)
		}
	})

	it('translates a channel through its own key', () => {
		expect(valueLabel('source', 'search', t)).toBe(`t(${keys.channelSearch})`)
	})

	it('reads a legacy host row under source as it was stored', () => {
		expect(valueLabel('source', 'google.com', t)).toBe('google.com')
	})

	it('answers a prototype member name as itself', () => {
		expect(valueLabel('source', 'constructor', t)).toBe('constructor')
		expect(valueLabel('source', '__proto__', t)).toBe('__proto__')
	})

	it('leaves every other dimension raw', () => {
		expect(valueLabel('referrer', 'search', t)).toBe('search')
		expect(valueLabel('page', '/pricing', t)).toBe('/pricing')
		expect(valueLabel('utmMedium', 'email', t)).toBe('email')
	})
})
