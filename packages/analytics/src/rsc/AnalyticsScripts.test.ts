import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { posthog } from '../adapters/posthog/posthog'
import type { TrackerConfig } from '../capture/trackerConfig'
import { AnalyticsScripts } from './AnalyticsScripts'

const posthogSnippet = () =>
	posthog({ projectId: '1', apiKey: 'phx_private', projectToken: 'phc_public' }).capture?.snippet({
		path: '/api/analytics/p/tenant',
	}) ?? { scripts: [] }

const config = (): TrackerConfig => ({
	slots: [
		{
			slot: 'global',
			kind: 'native',
			adapterId: 'native',
			path: '/api/analytics/p/global',
			snippet: { scripts: [] },
			client: { kind: 'native' },
			requiresConsent: false,
		},
		{
			slot: 'tenant',
			kind: 'posthog',
			adapterId: 'posthog',
			path: '/api/analytics/p/tenant',
			snippet: posthogSnippet(),
			client: { kind: 'posthog', token: 'phc_public' },
			requiresConsent: true,
		},
	],
	autoCapture: {
		scrollDepth: true,
		outboundLinks: true,
		fileDownloads: true,
		goalAttribute: true,
	},
	goals: [],
	ingestPath: '/api/analytics/ingest',
})

const render = (props: { config: TrackerConfig; nonce?: string }) =>
	renderToStaticMarkup(createElement(AnalyticsScripts, props))

describe('AnalyticsScripts', () => {
	it("renders each slot's snippet scripts, src and inline alike", () => {
		const html = render({ config: config() })
		expect(html).toContain('src="/api/analytics/p/tenant/static/array.js"')
		expect(html).toContain('async=""')
		expect(html).toContain('window.posthog.init("phc_public"')
	})

	it('leaves the inline init unescaped, so the snippet still parses', () => {
		const html = render({ config: config() })
		expect(html).toContain('{api_host:"/api/analytics/p/tenant"')
		expect(html).toContain('ui_host:"https://us.posthog.com"')
	})

	it('puts the nonce on every script it renders', () => {
		const html = render({ config: config(), nonce: 'n0nce' })
		const scripts = html.match(/<script/g) ?? []
		const nonced = html.match(/nonce="n0nce"/g) ?? []
		expect(scripts.length).toBeGreaterThanOrEqual(2)
		expect(nonced).toHaveLength(scripts.length)
	})

	it('renders nothing but the boot component for a native-only config', () => {
		const nativeOnly = config()
		nativeOnly.slots = nativeOnly.slots.slice(0, 1)
		expect(render({ config: nativeOnly })).toBe('')
	})

	it('carries an adapter snippet attrs bag onto the tag', () => {
		const withAttrs = config()
		const tenant = withAttrs.slots[1]
		if (tenant) {
			tenant.snippet = {
				scripts: [{ src: '/s.js', defer: true, attrs: { 'data-website-id': 'w1' } }],
			}
		}
		const html = render({ config: withAttrs })
		expect(html).toContain('data-website-id="w1"')
		expect(html).toContain('defer=""')
	})
})
