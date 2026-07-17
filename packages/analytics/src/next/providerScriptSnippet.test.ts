import { describe, expect, it } from 'vitest'
import { providerScriptSnippet } from './providerScriptSnippet'

describe('providerScriptSnippet', () => {
	it('builds a Plausible tag pointed at the proxy path, pinning data-api', () => {
		expect(providerScriptSnippet({ provider: 'plausible', domain: 'example.com' })).toBe(
			'<script defer data-domain="example.com" data-api="/pa/api/event" src="/pa/js/script.js"></script>'
		)
	})

	it('builds a Umami tag with data-host-url pointed at the proxy path', () => {
		expect(providerScriptSnippet({ provider: 'umami', websiteId: 'abc-123', path: '/track' })).toBe(
			'<script defer src="/track/script.js" data-website-id="abc-123" data-host-url="/track"></script>'
		)
	})

	it('builds a PostHog snippet that queues init in _i and self-loads array.js via the proxy', () => {
		const snippet = providerScriptSnippet({ provider: 'posthog', token: 'phc_key', region: 'eu' })
		expect(snippet).toContain('e._i=[]')
		expect(snippet).toContain('e._i.push([i,s,a])')
		expect(snippet).toContain('/static/array.js')
		expect(snippet).toContain("api_host:'/ph'")
		expect(snippet).toContain("ui_host:'https://eu.posthog.com'")
		expect(snippet).toContain("posthog.init('phc_key'")
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

	it('escapes < in the PostHog token so a crafted token cannot close the script tag', () => {
		const snippet = providerScriptSnippet({
			provider: 'posthog',
			token: '</script><script>alert(1)//',
		})
		expect(snippet).not.toContain('</script><script>')
		expect(snippet).toContain('\\x3C/script>\\x3Cscript>')
	})
})
