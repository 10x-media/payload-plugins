import { cleanup, render } from '@testing-library/react'
import type { ImportMap } from 'payload'
import { isValidElement, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ResolvedOptions } from '../core/options'
import { AnalyticsViewClient } from './AnalyticsViewClient'
import { type CountryFlagProps, RowFlag } from './CountryFlag'
import { SERVER_FLAG_WARNING } from './hostCountryFlag'
import { renderViewBody } from './viewBody'
import type { AnalyticsViewClientProps } from './viewProps'

vi.mock('@payloadcms/ui', () => ({
	useConfig: () => ({ config: { routes: { api: '/api' } } }),
}))

const props: AnalyticsViewClientProps = {
	sources: { defaultId: null, sources: [] },
	goals: [],
	defaults: { range: 'last30days', metric: 'pageviews' },
	endpoints: { query: '/api/_x/query', refresh: '/api/_x/refresh', live: '/api/_x/live' },
	adminRoute: '/admin',
	timezone: 'UTC',
	locale: 'en',
	countryFlags: false,
	scopeKey: 'tenant-a',
}

const view = (Component?: string): ResolvedOptions['view'] => ({
	path: '/analytics',
	defaultRange: 'last30days',
	defaultMetric: 'pageviews',
	navLink: true,
	...(Component === undefined ? {} : { Component }),
})

/** The host's view body: says which scope it was given and draws a German row's flag. */
function HostView(given: AnalyticsViewClientProps) {
	return (
		<section data-scope={given.scopeKey}>
			<RowFlag code="DE" flags={given.countryFlags} />
		</section>
	)
}

/** A `'use client'` module's export, as the import map holds it on the server. */
const asClientReference = <T extends object>(component: T): T =>
	Object.assign(component, { $$typeof: Symbol.for('react.client.reference') })

const HostFlag = asClientReference(function HostFlag({
	code,
	tone,
}: CountryFlagProps & { tone?: string }) {
	return <i className="host-flag" data-code={code} data-tone={tone} />
})

function ServerFlag({ code }: CountryFlagProps) {
	return <i className="server-flag" data-code={code} />
}

const importMap: ImportMap = {
	'/views/HostView#HostView': HostView,
	'/components/HostFlag#HostFlag': HostFlag,
	'/components/ServerFlag#ServerFlag': ServerFlag,
}

afterEach(() => {
	cleanup()
	vi.restoreAllMocks()
})

describe('renderViewBody', () => {
	it("renders the plugin's own body, keyed on the scope, when the host replaced nothing", () => {
		const body = renderViewBody({
			resolved: { view: view(), countryFlags: true },
			props: { ...props, countryFlags: true },
			importMap,
		})
		expect(isValidElement(body) && body.type).toBe(AnalyticsViewClient)
		expect(isValidElement(body) && body.key).toBe('tenant-a')
	})

	it("renders the host's view.Component in its place, with the same props", () => {
		const body = renderViewBody({
			resolved: { view: view('/views/HostView#HostView'), countryFlags: false },
			props,
			importMap,
		})
		render(body as ReactNode)
		expect(document.querySelector('section')?.getAttribute('data-scope')).toBe('tenant-a')
		expect(document.querySelector('.host-flag')).toBeNull()
	})

	it("hands the host's flag component down, for each row to render with its code and props", () => {
		const body = renderViewBody({
			resolved: {
				view: view('/views/HostView#HostView'),
				countryFlags: {
					Component: {
						path: '/components/HostFlag',
						exportName: 'HostFlag',
						clientProps: { tone: 'soft' },
					},
				},
			},
			props,
			importMap,
		})
		render(body as ReactNode)
		const flag = document.querySelector('.host-flag')
		expect(flag?.getAttribute('data-code')).toBe('DE')
		expect(flag?.getAttribute('data-tone')).toBe('soft')
	})

	it('hands no server component to the client, where it could not render, and says so once', () => {
		const warn = vi.fn<(message: string) => void>()
		const countryFlags = { Component: '/components/ServerFlag#ServerFlag' }
		const body = renderViewBody({
			resolved: { view: view('/views/HostView#HostView'), countryFlags },
			props,
			importMap,
			warn,
		})
		render(body as ReactNode)
		expect(document.querySelector('section')).not.toBeNull()
		expect(document.querySelector('.server-flag')).toBeNull()
		renderViewBody({
			resolved: { view: view('/views/HostView#HostView'), countryFlags },
			props,
			importMap,
			warn,
		})
		expect(warn.mock.calls).toEqual([[SERVER_FLAG_WARNING]])
	})

	it("falls back to the plugin's own body when the import map lacks the host's, naming the fix", () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})
		const body = renderViewBody({
			resolved: { view: view('/views/Missing#Missing'), countryFlags: false },
			props,
			importMap,
		})
		const fallback = isValidElement(body) ? body.type : undefined
		const inner = typeof fallback === 'function' ? (fallback as () => ReactNode)() : null
		expect(isValidElement(inner) && inner.type).toBe(AnalyticsViewClient)
		expect(isValidElement(inner) && inner.props).toEqual(props)
		expect(isValidElement(body) && body.key).toBe('tenant-a')
		expect(String(error.mock.calls[0]?.at(-1))).toContain('payload generate:importmap')
	})

	it('draws no flag rather than a broken one when the import map lacks the component', () => {
		vi.spyOn(console, 'error').mockImplementation(() => {})
		const body = renderViewBody({
			resolved: {
				view: view('/views/HostView#HostView'),
				countryFlags: { Component: '/components/Missing#Missing' },
			},
			props,
			importMap,
		})
		render(body as ReactNode)
		expect(document.querySelector('section')).not.toBeNull()
		expect(document.querySelector('.host-flag')).toBeNull()
		expect(document.querySelector('img')).toBeNull()
	})
})
