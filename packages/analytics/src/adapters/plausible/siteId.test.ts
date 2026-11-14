import { describe, expect, it } from 'vitest'
import { validateSiteDomain, validateSiteDomains } from './siteId'

const args = { req: { t: (key: string) => key } } as never

// Each case was checked against Plausible CE 3.2.1's own site changeset (`Plausible.Site.changeset`).
describe('validateSiteDomain', () => {
	it.each([
		['blank', '', true],
		['a domain', 'example.com', true],
		['a subdomain with a hyphen', 'sub-domain.example.com', true],
		['a site in a subfolder', 'example.com/blog', true],
		['an internationalised domain', 'пример.рф', true],
		['a domain with spaces around it', '  example.com  ', true],
		['an address with https://', 'https://example.com', 'analytics:providerErrorSiteDomain'],
		['a domain starting with www.', 'www.example.com', 'analytics:providerErrorSiteDomain'],
		['a trailing slash', 'example.com/', 'analytics:providerErrorSiteDomain'],
		['capital letters', 'Example.com', 'analytics:providerErrorSiteDomain'],
		['a port', 'localhost:3000', 'analytics:providerErrorSiteDomain'],
		['a query', 'example.com?x=1', 'analytics:providerErrorSiteDomain'],
		['two words', 'example com', 'analytics:providerErrorSiteDomain'],
	] as const)('%s', (_name, value, expected) => {
		expect(validateSiteDomain(value, args)).toBe(expected)
	})
})

describe('validateSiteDomains', () => {
	it.each([
		['blank', '', true],
		['one site', 'example.com', true],
		['sites for several dashboards', 'example.com,rollup.example', true],
		['spaces around the commas', 'example.com, rollup.example', true],
		[
			'one site of the list pasted as an address',
			'example.com,https://rollup.example',
			'analytics:providerErrorSiteDomain',
		],
		['an empty entry', 'example.com,,rollup.example', 'analytics:providerErrorSiteDomain'],
	] as const)('%s', (_name, value, expected) => {
		expect(validateSiteDomains(value, args)).toBe(expected)
	})
})
