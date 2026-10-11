import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'
import { type AnalyticsPluginOptions, resolveOptions } from '../core/options'
import { memoryAdapter } from '../testing/memoryAdapter'
import { NAV_LINK_COMPONENT, registerView, VIEW_COMPONENT, VIEW_KEY } from './registerView'

const bareConfig = (): Config => ({}) as Config

const register = (config: Config, options: Omit<AnalyticsPluginOptions, 'adapters'> = {}): void => {
	const pluginOptions: AnalyticsPluginOptions = { adapters: [memoryAdapter()], ...options }
	registerView(config, { view: resolveOptions(pluginOptions).view })
}

const viewOf = (config: Config) => config.admin?.components?.views?.[VIEW_KEY]

describe('registerView', () => {
	it('mounts the view at /analytics through the package export map', () => {
		const config = bareConfig()
		register(config)
		const view = viewOf(config)
		expect(view?.path).toBe('/analytics')
		expect(view?.exact).toBe(true)
		expect(view?.Component).toMatchObject({ path: VIEW_COMPONENT })
	})

	it('hands the server component no options: it reads what the plugin resolved', () => {
		const config = bareConfig()
		const pluginOptions: AnalyticsPluginOptions = { adapters: [memoryAdapter()] }
		registerView(config, { view: resolveOptions(pluginOptions).view })
		expect(viewOf(config)?.Component).toEqual({ path: VIEW_COMPONENT })
	})

	it('adds a nav link pointing at the admin-prefixed view path', () => {
		const config = bareConfig()
		register(config)
		const links = config.admin?.components?.afterNavLinks ?? []
		expect(links).toHaveLength(1)
		expect(links[0]).toEqual({
			path: NAV_LINK_COMPONENT,
			clientProps: { href: '/admin/analytics' },
		})
	})

	it('follows a custom view path and the app admin route', () => {
		const config = { routes: { admin: '/cms' } } as Config
		register(config, { view: { path: '/insights' } })
		expect(viewOf(config)?.path).toBe('/insights')
		expect(config.admin?.components?.afterNavLinks?.[0]).toMatchObject({
			clientProps: { href: '/cms/insights' },
		})
	})

	it('carries a navLabel override into the nav link client props', () => {
		const config = bareConfig()
		register(config, { view: { navLabel: { en: 'Traffic', de: 'Verkehr' } } })
		expect(config.admin?.components?.afterNavLinks?.[0]).toMatchObject({
			clientProps: { label: { en: 'Traffic', de: 'Verkehr' } },
		})
	})

	it('registers nothing when the view is disabled', () => {
		const config = bareConfig()
		register(config, { view: false })
		expect(viewOf(config)).toBeUndefined()
		expect(config.admin?.components?.afterNavLinks).toBeUndefined()
	})

	it('keeps the app existing views and nav links', () => {
		const config = {
			admin: {
				components: {
					views: { custom: { Component: '@app/Custom', path: '/custom' as const } },
					afterNavLinks: ['@app/Link'],
					beforeNavLinks: ['@app/Before'],
				},
			},
		} as unknown as Config
		register(config)
		expect(config.admin?.components?.views?.custom).toBeDefined()
		expect(viewOf(config)).toBeDefined()
		expect(config.admin?.components?.afterNavLinks).toHaveLength(2)
		expect(config.admin?.components?.afterNavLinks?.[0]).toBe('@app/Link')
		expect(config.admin?.components?.beforeNavLinks).toEqual(['@app/Before'])
	})

	// Payload titles a custom view's tab from its meta, which no request's language reaches.
	it("titles the browser tab in the app's fallback language", () => {
		const title = { en: 'Analytics', de: 'Statistiken' }
		const pluginOptions: AnalyticsPluginOptions = { adapters: [memoryAdapter()] }
		const english = bareConfig()
		registerView(english, { view: resolveOptions(pluginOptions).view, title })
		expect(viewOf(english)?.meta).toEqual({ title: 'Analytics' })
		const german = { i18n: { fallbackLanguage: 'de' } } as Config
		registerView(german, { view: resolveOptions(pluginOptions).view, title })
		expect(viewOf(german)?.meta).toEqual({ title: 'Statistiken' })
	})
})
