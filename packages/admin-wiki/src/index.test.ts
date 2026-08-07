import type { Config, PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'

import { adminWiki, getWikiRegistry } from './index'
import { keys } from './translations'

const fakeConfig = () => ({ collections: [] }) as unknown as Config

describe('adminWiki factory', () => {
	it('returns a Payload plugin function', () => {
		expect(typeof adminWiki({})).toBe('function')
	})

	it('returns the incoming config when disabled', () => {
		const cfg = fakeConfig()
		expect(adminWiki({ disabled: true })(cfg)).toBe(cfg)
	})

	it('applies the translations option', () => {
		const out = adminWiki({ translations: { de: { [keys.pluginName]: 'Beispiel' } } })(
			fakeConfig()
		) as Config
		const i18n = out.i18n?.translations as Record<string, Record<string, Record<string, string>>>
		expect(i18n.de?.adminWiki?.pluginName).toBe('Beispiel')
		expect(i18n.en?.adminWiki?.pluginName).toBe('Admin Wiki')
	})

	it('registers both wiki collections with default slugs', () => {
		const out = adminWiki({})(fakeConfig()) as Config
		const slugs = (out.collections ?? []).map((collection) => collection.slug)
		expect(slugs).toEqual(['wiki-pages', 'wiki-media'])
	})

	it('honors slug overrides and writes the registry', () => {
		const out = adminWiki({ slugs: { media: 'guide-media', pages: 'guides' } })(
			fakeConfig()
		) as Config
		const slugs = (out.collections ?? []).map((collection) => collection.slug)
		expect(slugs).toEqual(['guides', 'guide-media'])
		expect(getWikiRegistry(out)?.slugs).toEqual({ media: 'guide-media', pages: 'guides' })
	})

	it('defaults every access operation to logged-in and honors overrides', async () => {
		const publicRead = () => true
		const out = adminWiki({ access: { read: publicRead } })(fakeConfig()) as Config
		const access = out.collections?.[0]?.access
		expect(access?.read).toBe(publicRead)
		const req = { user: null } as unknown as PayloadRequest
		expect(await access?.create?.({ req })).toBe(false)
	})

	it('registers the wiki views by default and omits them when disabled', () => {
		const withView = adminWiki({})(fakeConfig()) as Config
		const views = withView.admin?.components?.views ?? {}
		expect(views.adminWikiIndex).toMatchObject({ exact: true, path: '/wiki' })
		expect(views.adminWikiPage).toMatchObject({ exact: true, path: '/wiki/:slug' })
		const listActions = withView.collections?.[0]?.admin?.components?.views?.list?.actions ?? []
		expect(listActions).toHaveLength(1)

		const withoutView = adminWiki({ wikiView: false })(fakeConfig()) as Config
		expect(withoutView.admin?.components?.views).toBeUndefined()
		expect(withoutView.collections?.[0]?.admin?.components?.views).toBeUndefined()
	})

	it('extends media mimetypes only when video is enabled', () => {
		const withoutVideo = adminWiki({})(fakeConfig()) as Config
		const withVideo = adminWiki({ video: true })(fakeConfig()) as Config
		const mimeTypes = (config: Config) => {
			const upload = config.collections?.[1]?.upload
			return typeof upload === 'object' ? upload.mimeTypes : undefined
		}
		expect(mimeTypes(withoutVideo)).toEqual(['image/*'])
		expect(mimeTypes(withVideo)).toEqual(['image/*', 'video/*'])
	})
})
