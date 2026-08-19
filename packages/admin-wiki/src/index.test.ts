import type { Config, Field, PayloadRequest } from 'payload'
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

	it('registers the wiki view slot components as import map dependencies', () => {
		const out = adminWiki({
			wikiView: {
				components: {
					afterTable: [{ path: '/components/Footer', exportName: 'Footer' }],
					beforeControls: ['/components/Export#ExportButton'],
					beforeTable: [{ path: '/components/Notice#Notice', clientProps: { tone: 'warn' } }],
				},
			},
		})(fakeConfig()) as Config
		// The generator reads the export after `#` and defaults to the default
		// export, so an `exportName` has to be folded into the registered path.
		expect(Object.values(out.admin?.dependencies ?? {})).toEqual([
			{ path: '/components/Footer#Footer', type: 'component' },
			{ path: '/components/Export#ExportButton', type: 'component' },
			{ path: '/components/Notice#Notice', type: 'component' },
		])
		expect(getWikiRegistry(out)?.wikiView).toMatchObject({
			components: { beforeControls: ['/components/Export#ExportButton'] },
		})
	})

	it('offers only covered entities in the collection and global target pickers', () => {
		const cfg = {
			collections: [
				{ fields: [], slug: 'posts' },
				{ fields: [], slug: 'users' },
				{ fields: [], slug: 'payload-preferences' },
			],
			globals: [
				{ fields: [], slug: 'settings' },
				{ fields: [], slug: 'nav' },
			],
		} as unknown as Config
		const out = adminWiki({ exclude: { collections: ['users'], globals: ['nav'] } })(cfg) as Config
		const pages = out.collections?.find((collection) => collection.slug === 'wiki-pages')
		const tabs = pages?.fields[0] as { tabs: { fields: Field[] }[] }
		const clientPropsOf = (name: string) =>
			(
				tabs.tabs[1]?.fields.find((field) => 'name' in field && field.name === name) as unknown as {
					admin: { components: { Field: { clientProps: unknown; path: string } } }
				}
			).admin.components.Field
		expect(clientPropsOf('targetCollections')).toEqual({
			clientProps: { entity: 'collection', slugs: ['posts'] },
			path: '@10x-media/admin-wiki/client#WikiTargetSelect',
		})
		expect(clientPropsOf('targetGlobals')).toEqual({
			clientProps: { entity: 'global', slugs: ['settings'] },
			path: '@10x-media/admin-wiki/client#WikiTargetSelect',
		})
		expect(clientPropsOf('targetBlocks')).toEqual({
			clientProps: { slugs: [] },
			path: '@10x-media/admin-wiki/client#WikiTargetBlocks',
		})
	})

	it('adds the custom target list only when custom targets are declared', () => {
		const targetNames = (config: Config): string[] => {
			const pages = config.collections?.find((collection) => collection.slug === 'wiki-pages')
			const tabs = pages?.fields[0] as { tabs: { fields: Field[] }[] }
			return (tabs.tabs[1]?.fields ?? []).flatMap((field) =>
				'name' in field ? [field.name] : []
			)
		}
		expect(targetNames(adminWiki({})(fakeConfig()) as Config)).not.toContain('targetCustom')

		const withCustom = adminWiki({
			customTargets: [{ key: 'dashboard', label: 'Dashboard' }, 'traffic'],
		})(fakeConfig()) as Config
		expect(targetNames(withCustom)).toContain('targetCustom')

		const pages = withCustom.collections?.find((collection) => collection.slug === 'wiki-pages')
		const tabs = pages?.fields[0] as { tabs: { fields: Field[] }[] }
		const customField = tabs.tabs[1]?.fields.find(
			(field) => 'name' in field && field.name === 'targetCustom'
		) as unknown as { admin: { components: { Field: { clientProps: unknown; path: string } } } }
		expect(customField.admin.components.Field).toEqual({
			clientProps: {
				targets: [
					{ key: 'dashboard', label: 'Dashboard' },
					{ key: 'traffic', label: 'traffic' },
				],
			},
			path: '@10x-media/admin-wiki/client#WikiTargetCustom',
		})
	})

	it('counts declared custom targets as valid target keys', () => {
		const out = adminWiki({ customTargets: ['dashboard'] })(fakeConfig()) as Config
		expect(getWikiRegistry(out)?.validTargetKeys).toContain('custom:dashboard')
		expect(getWikiRegistry(out)?.validTargetKeys).not.toContain('custom:traffic')
	})

	it('offers only covered blocks in the block target picker', () => {
		const cfg = {
			collections: [
				{
					slug: 'pages',
					fields: [
						{
							name: 'layout',
							type: 'blocks',
							blocks: [
								{ slug: 'hero', fields: [] },
								{ slug: 'spacer', fields: [] },
							],
						},
					],
				},
			],
		} as unknown as Config
		const out = adminWiki({ exclude: { blocks: ['spacer'] } })(cfg) as Config
		const pages = out.collections?.find((collection) => collection.slug === 'wiki-pages')
		const tabs = pages?.fields[0] as { tabs: { fields: Field[] }[] }
		const blocksField = tabs.tabs[1]?.fields.find(
			(field) => 'name' in field && field.name === 'targetBlocks'
		) as unknown as { admin: { components: { Field: { clientProps: { slugs: string[] } } } } }
		expect(blocksField.admin.components.Field.clientProps.slugs).toEqual(['hero'])
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
