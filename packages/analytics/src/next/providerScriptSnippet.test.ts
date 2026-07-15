import { describe, expect, it } from 'vitest'
import { providerScriptSnippet } from './providerScriptSnippet'

describe('providerScriptSnippet', () => {
	it('builds a Plausible tag pointed at the proxy path', () => {
		expect(providerScriptSnippet({ provider: 'plausible', domain: 'example.com' })).toBe(
			'<script defer data-domain="example.com" src="/pa/js/script.js"></script>'
		)
	})

	it('builds a Umami tag pointed at the proxy path', () => {
		expect(providerScriptSnippet({ provider: 'umami', websiteId: 'abc-123', path: '/track' })).toBe(
			'<script defer src="/track/script.js" data-website-id="abc-123"></script>'
		)
	})

	it('builds a PostHog snippet using the proxy path as api_host', () => {
		const snippet = providerScriptSnippet({ provider: 'posthog', token: 'phc_key', region: 'eu' })
		expect(snippet).toContain("api_host:'/ph'")
		expect(snippet).toContain("ui_host:'https://eu.posthog.com'")
		expect(snippet).toContain("init('phc_key'")
		expect(snippet).toContain('src="/ph/static/array.js"')
	})

	it('escapes attribute values so a crafted domain cannot break out of the tag', () => {
		const snippet = providerScriptSnippet({
			provider: 'plausible',
			domain: 'a"><img src=x>',
		})
		expect(snippet).not.toContain('"><img')
		expect(snippet).toContain('a&quot;')
		expect(snippet).toContain('&lt;img')
	})

	it('escapes the PostHog token so it cannot break the init string', () => {
		const snippet = providerScriptSnippet({ provider: 'posthog', token: "x');alert(1)//" })
		expect(snippet).toContain("init('x\\');alert(1)//'")
	})
})
