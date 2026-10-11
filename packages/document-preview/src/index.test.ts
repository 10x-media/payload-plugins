import type { CollectionConfig, Config, UIField } from 'payload'
import { describe, expect, it } from 'vitest'

import { documentPreview } from './index'
import { COLUMN_FIELD_NAME, INLINE_FIELD_NAME } from './plugin/injectCollections'
import { getRegistry } from './plugin/registry'
import { keys } from './translations'

const media = (overrides: Partial<CollectionConfig> = {}): CollectionConfig => ({
	slug: 'media',
	fields: [{ name: 'alt', type: 'text' }],
	upload: true,
	...overrides,
})

const fakeConfig = (collections: CollectionConfig[] = [media()]) =>
	({ collections }) as unknown as Config

const run = (options: Parameters<typeof documentPreview>[0], config = fakeConfig()) =>
	documentPreview(options)(config) as Config

const collection = (config: Config, slug = 'media') =>
	config.collections?.find((candidate) => candidate.slug === slug) as CollectionConfig

const controls = (config: Config) =>
	collection(config).admin?.components?.edit?.beforeDocumentControls ?? []

const fieldNames = (config: Config) =>
	collection(config).fields.map((field) => ('name' in field ? field.name : undefined))

describe('documentPreview factory', () => {
	it('returns a Payload plugin function', () => {
		expect(typeof documentPreview({ collections: {} })).toBe('function')
	})

	it('returns the incoming config when disabled', () => {
		const cfg = fakeConfig()
		expect(documentPreview({ collections: { media: true }, disabled: true })(cfg)).toBe(cfg)
	})

	it('applies the translations option', () => {
		const out = run({ collections: {}, translations: { de: { [keys.pluginName]: 'Beispiel' } } })
		const i18n = out.i18n?.translations as Record<string, Record<string, Record<string, string>>>
		expect(i18n.de?.documentPreview?.pluginName).toBe('Beispiel')
		expect(i18n.en?.documentPreview?.pluginName).toBe('Document Preview')
	})

	it('registers the admin provider', () => {
		expect(run({ collections: {} }).admin?.components?.providers).toContain(
			'@10x-media/document-preview/rsc#DocumentPreviewProviderServer'
		)
	})
})

describe('collection wiring', () => {
	it('defaults to a drawer button, the filesize cell and file icons', () => {
		const out = run({ collections: { media: true } })
		expect(controls(out)).toEqual(['@10x-media/document-preview/client#DocumentPreviewButton'])
		expect(fieldNames(out)).toEqual(['alt', 'filesize', 'thumbnailURL'])
	})

	it('keeps controls the host already declared', () => {
		const out = run(
			{ collections: { media: true } },
			fakeConfig([
				media({ admin: { components: { edit: { beforeDocumentControls: ['/host#Control'] } } } }),
			])
		)
		expect(controls(out)).toEqual([
			'/host#Control',
			'@10x-media/document-preview/client#DocumentPreviewButton',
		])
	})

	it('puts the inline preview first, without a list column', () => {
		const out = run({ collections: { media: { display: 'inline' } } })
		expect(controls(out)).toEqual([])
		expect(fieldNames(out)).toEqual([INLINE_FIELD_NAME, 'alt', 'filesize', 'thumbnailURL'])
		const field = collection(out).fields[0] as UIField
		expect(field.admin?.components?.Field).toBe(
			'@10x-media/document-preview/client#DocumentPreviewInlineField'
		)
		expect(field.admin?.disableListColumn).toBe(true)
	})

	it('wires both surfaces for display "both"', () => {
		const out = run({ collections: { media: { display: 'both' } } })
		expect(controls(out)).toHaveLength(1)
		expect(fieldNames(out)[0]).toBe(INLINE_FIELD_NAME)
	})

	it('adds the list column last, and to explicit default columns', () => {
		const out = run(
			{ collections: { media: { listView: true } } },
			fakeConfig([media({ admin: { defaultColumns: ['filename'] } })])
		)
		expect(fieldNames(out)).toContain(COLUMN_FIELD_NAME)
		expect(collection(out).admin?.defaultColumns).toEqual(['filename', COLUMN_FIELD_NAME])
		const field = collection(out).fields.find(
			(candidate) => 'name' in candidate && candidate.name === COLUMN_FIELD_NAME
		) as UIField
		expect(field.admin?.components?.Cell).toBe(
			'@10x-media/document-preview/client#DocumentPreviewCell'
		)
		expect(field.label).toMatchObject({ de: 'Vorschau', en: 'Preview', uk: 'Перегляд' })
	})

	it('declares only a Cell on filesize, for Payload to merge into its upload field', () => {
		const out = run({ collections: { media: true } })
		const field = collection(out).fields.find(
			(candidate) => 'name' in candidate && candidate.name === 'filesize'
		)
		expect(field).toEqual({
			name: 'filesize',
			type: 'number',
			admin: {
				components: { Cell: '@10x-media/document-preview/client#DocumentPreviewFilesizeCell' },
			},
		})
	})

	it('adds the cell to a filesize field the collection declares, keeping its settings', () => {
		const out = run(
			{ collections: { media: { fileIcons: false } } },
			fakeConfig([
				media({ fields: [{ name: 'filesize', type: 'number', admin: { description: 'Bytes' } }] }),
			])
		)
		expect(collection(out).fields).toEqual([
			{
				name: 'filesize',
				type: 'number',
				admin: {
					components: { Cell: '@10x-media/document-preview/client#DocumentPreviewFilesizeCell' },
					description: 'Bytes',
				},
			},
		])
	})

	it('keeps a filesize Cell the collection set, and skips the cell when opted out', () => {
		const own = media({
			fields: [{ name: 'filesize', type: 'number', admin: { components: { Cell: '/own#Cell' } } }],
		})
		expect(
			collection(run({ collections: { media: { fileIcons: false } } }, fakeConfig([own]))).fields
		).toEqual(own.fields)
		expect(
			fieldNames(run({ collections: { media: { fileIcons: false, filesizeCell: false } } }))
		).toEqual(['alt'])
	})

	it('leaves collections that are not listed untouched', () => {
		const docs = media({ slug: 'docs' })
		const out = run({ collections: { media: true } }, fakeConfig([media(), docs]))
		expect(collection(out, 'docs')).toBe(docs)
	})
})

describe('viewer overrides', () => {
	it('stores resolved options and registers every viewer path as an import map dependency', () => {
		const out = run({
			collections: { media: { viewers: { 'video/*': '/viewers#Bunny' } } },
			viewers: { 'application/pdf': '/viewers#Pdf' },
		})
		expect(getRegistry(out)).toEqual({
			fileIcons: [],
			collections: {
				media: {
					display: 'drawer',
					fileIcons: true,
					filesizeCell: true,
					listView: false,
					viewers: { 'video/*': '/viewers#Bunny' },
				},
			},
			viewers: { 'application/pdf': '/viewers#Pdf' },
		})
		expect(out.admin?.dependencies).toEqual({
			'document-preview:/viewers#Bunny': { path: '/viewers#Bunny', type: 'component' },
			'document-preview:/viewers#Pdf': { path: '/viewers#Pdf', type: 'component' },
		})
	})

	it('lets a global fileIcons default be overridden per collection', () => {
		const media2 = media({ slug: 'media2' })
		const out = run(
			{ collections: { media: true, media2: { fileIcons: true } }, fileIcons: false },
			fakeConfig([media(), media2])
		)
		expect(fieldNames(out)).not.toContain('thumbnailURL')
		expect(
			collection(out, 'media2').fields.map((field) => ('name' in field ? field.name : undefined))
		).toContain('thumbnailURL')
		expect(out.endpoints).toHaveLength(1)
		expect(run({ collections: { media: true }, fileIcons: false }).endpoints).toBeUndefined()
	})

	it('adds no dependencies without overrides', () => {
		expect(run({ collections: { media: true } }).admin?.dependencies).toBeUndefined()
	})
})

describe('validation', () => {
	it('rejects an unknown collection', () => {
		expect(() => run({ collections: { nope: true } as never })).toThrow(
			/"nope" is not in the config/
		)
	})

	it('rejects a collection without uploads', () => {
		expect(() =>
			run({ collections: { media: true } }, fakeConfig([media({ upload: undefined })]))
		).toThrow(/not an upload collection/)
	})

	it('rejects an invalid display', () => {
		expect(() => run({ collections: { media: { display: 'modal' as never } } })).toThrow(
			/invalid display "modal"/
		)
	})

	it('rejects malformed viewer keys', () => {
		expect(() => run({ collections: {}, viewers: { '*': '/x#Y' } })).toThrow(
			/invalid viewer key "\*" in viewers/
		)
		expect(() => run({ collections: { media: { viewers: { 'Video/MP4': '/x#Y' } } } })).toThrow(
			/collections\.media\.viewers/
		)
	})

	it('rejects malformed file icon types', () => {
		expect(() =>
			run({ collections: {}, fileIcons: { types: { model: { color: '#000', label: '3D' } } } })
		).toThrow(/invalid mime pattern/)
		expect(() =>
			run({ collections: {}, fileIcons: { types: { 'model/*': { svg: '<div/>' } } } })
		).toThrow(/must be an SVG document/)
		expect(() =>
			run({ collections: {}, fileIcons: { types: { 'model/*': { color: '', label: '3D' } } } })
		).toThrow(/needs a label and a color/)
	})

	it('rejects a field name the preview needs', () => {
		expect(() =>
			run(
				{ collections: { media: { display: 'inline' } } },
				fakeConfig([media({ fields: [{ name: INLINE_FIELD_NAME, type: 'text' }] })])
			)
		).toThrow(/already has a field named "documentPreview"/)
	})
})
