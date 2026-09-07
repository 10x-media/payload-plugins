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

const config = (requiresConsent = false): TrackerConfig => ({
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
			requiresConsent,
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
	/** A slot carrying both script forms, since a given vendor only uses one of them. */
	const bothForms = (): TrackerConfig => {
		const mixed = config()
		const tenant = mixed.slots[1]
		if (tenant) {
			tenant.snippet = {
				scripts: [{ src: '/pl/js/pa-abc.js', async: true }, { inline: 'plausible.init({})' }],
			}
		}
		return mixed
	}

	it("renders each slot's snippet scripts, src and inline alike", () => {
		const html = render({ config: bothForms() })
		expect(html).toContain('src="/pl/js/pa-abc.js"')
		expect(html).toContain('async=""')
		expect(html).toContain('plausible.init({})')
	})

	it('leaves the inline init unescaped, so the snippet still parses', () => {
		const html = render({ config: config() })
		expect(html).toContain('posthog.init("phc_public"')
		expect(html).toContain('{api_host:"/api/analytics/p/tenant"')
		expect(html).toContain('ui_host:"https://us.posthog.com"')
	})

	it('puts the nonce on every script it renders', () => {
		const html = render({ config: bothForms(), nonce: 'n0nce' })
		const scripts = html.match(/<script/g) ?? []
		const nonced = html.match(/nonce="n0nce"/g) ?? []
		expect(scripts.length).toBeGreaterThanOrEqual(2)
		expect(nonced).toHaveLength(scripts.length)
	})

	it('renders no snippet for a slot that waits for consent', () => {
		const html = render({ config: config(true) })

		expect(html).toBe('')
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
