import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { posthog } from '../adapters/posthog/posthog'
import { withExclusionPrelude } from '../capture/exclusionPrelude'
import { TrackerBoot, type TrackerBootProps } from '../react/TrackerBoot'
import type { TrackerConfig } from '../tracker/config'
import { AnalyticsScripts, type AnalyticsScriptsProps } from './AnalyticsScripts'

const posthogSnippet = () =>
	posthog({ projectId: '1', apiKey: 'phx_private', projectToken: 'phc_public' }).capture?.snippet({
		path: '/api/_x/p/tenant',
	}) ?? { scripts: [] }

const config = (gated = false): TrackerConfig => ({
	slots: [
		{
			slot: 'global',
			kind: 'native',
			adapterId: 'native',
			path: '/api/_x/p/global',
			snippet: { scripts: [] },
			client: { kind: 'native' },
			gated: false,
		},
		{
			slot: 'tenant',
			kind: 'posthog',
			adapterId: 'posthog',
			path: '/api/_x/p/tenant',
			snippet: posthogSnippet(),
			client: { kind: 'posthog', token: 'phc_public' },
			gated,
		},
	],
	autoCapture: {
		scrollDepth: true,
		outboundLinks: true,
		fileDownloads: true,
		goalAttribute: true,
		query: true,
		items: { impressions: true, clicks: true, pages: true },
	},
	goals: [],
	ingestPath: '/api/_x/e',
})

const render = (props: AnalyticsScriptsProps) =>
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
		expect(html).toContain('{api_host:"/api/_x/p/tenant"')
		expect(html).toContain('ui_host:"https://us.posthog.com"')
	})

	it('puts the nonce on every script it renders', () => {
		const html = render({ config: bothForms(), nonce: 'n0nce' })
		const scripts = html.match(/<script/g) ?? []
		const nonced = html.match(/nonce="n0nce"/g) ?? []
		expect(scripts.length).toBeGreaterThanOrEqual(2)
		expect(nonced).toHaveLength(scripts.length)
	})

	it('renders nothing for a held slot, whose snippet travels in the config as data', () => {
		const held = config(true)
		const html = render({ config: held })

		expect(html).toBe('')
		expect(held.slots[1]?.snippet.scripts[0]?.inline).toContain('posthog.init("phc_public"')
	})

	it('renders a held slot whose gate the server already opened', () => {
		expect(render({ config: config(true), gate: { tenant: true } })).toContain(
			'posthog.init("phc_public"'
		)
		expect(render({ config: config(true), gate: true })).toContain('posthog.init("phc_public"')
		expect(render({ config: config(true), gate: { global: true } })).toBe('')
	})

	it('renders nothing for a slot the server closed by name, held or not', () => {
		expect(render({ config: config(false), gate: { tenant: false } })).toBe('')
		expect(render({ config: config(true), gate: false })).toBe('')
	})

	it('keeps rendering an ungated slot a boolean answer does not reach', () => {
		expect(render({ config: config(false), gate: false })).toContain('posthog.init("phc_public"')
	})

	it('renders the exclusion prelude ahead of the vendor init, in document order', () => {
		const linked = config()
		const tenant = linked.slots[1]
		if (tenant) {
			tenant.snippet = withExclusionPrelude(tenant.snippet, 'analytics_exclude')
		}
		const html = render({ config: linked })
		const prelude = html.indexOf('history.replaceState')
		expect(prelude).toBeGreaterThan(-1)
		expect(prelude).toBeLessThan(html.indexOf('posthog.init("phc_public"'))
	})

	it('renders no snippet for a page the server rendered in draft mode, unless previews count', () => {
		expect(render({ config: { ...config(), draft: true } })).toBe('')
		expect(
			render({
				config: { ...config(), draft: true, skip: { automation: true, previews: false } },
			})
		).toContain('posthog.init("phc_public"')
	})

	it('renders no snippet at all under snippets={false}, gate or no gate', () => {
		expect(render({ config: bothForms(), snippets: false })).toBe('')
		expect(render({ config: config(true), gate: true, snippets: false })).toBe('')
		expect(render({ config: bothForms(), snippets: true })).toContain('src="/pl/js/pa-abc.js"')
	})

	it('boots the tracker with the gate, the snippets flag and the nonce, and no loader', () => {
		const tree = AnalyticsScripts({
			config: config(true),
			gate: { tenant: true },
			snippets: false,
			nonce: 'n0nce',
		})
		const children: unknown[] = isValidElement<{ children?: ReactNode }>(tree)
			? Children.toArray(tree.props.children)
			: []
		const boot = children.find(
			(child): child is ReactElement<TrackerBootProps> =>
				isValidElement(child) && child.type === TrackerBoot
		)

		expect(boot?.props).toEqual({
			config: config(true),
			gate: { tenant: true },
			snippets: false,
			nonce: 'n0nce',
		})
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
