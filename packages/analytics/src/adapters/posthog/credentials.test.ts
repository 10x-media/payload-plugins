import { describe, expect, it } from 'vitest'
import { validatePersonalApiKey, validateProjectToken } from './credentials'

const t = { req: { t: (key: string) => key } } as never

describe('validatePersonalApiKey', () => {
	it.each([
		['blank, which keeps a stored key', '', true],
		['a personal API key', 'phx_abc123', true],
		['a project token', 'phc_abc123', 'analytics:providerErrorPosthogTokenAsApiKey'],
		['a project token after spaces', '  phc_abc123', 'analytics:providerErrorPosthogTokenAsApiKey'],
		[
			'a project token before spaces',
			'phc_abc123  ',
			'analytics:providerErrorPosthogTokenAsApiKey',
		],
		['a key that only contains the prefix', 'xphc_abc123', true],
		['only spaces', '   ', true],
	])('%s', (_name, value, expected) => {
		expect(validatePersonalApiKey(value, t)).toBe(expected)
	})
})

describe('validateProjectToken', () => {
	it.each([
		['blank', '', true],
		['a project token', 'phc_abc123', true],
		['a personal API key', 'phx_abc123', 'analytics:providerErrorPosthogKeyAsToken'],
		['a secret token', 'phs_abc123', 'analytics:providerErrorPosthogKeyAsToken'],
		[
			'a personal API key inside spaces',
			' phx_abc123 ',
			'analytics:providerErrorPosthogKeyAsToken',
		],
		['only spaces', '   ', true],
	])('%s', (_name, value, expected) => {
		expect(validateProjectToken(value, t)).toBe(expected)
	})
})
