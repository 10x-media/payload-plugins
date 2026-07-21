import type { CollectionConfig, Config } from 'payload'
import { describe, expect, it } from 'vitest'
import type { ResolvedSpamConfig } from '../spam/types'
import { attachUploadsCollection, readUploadCollectionMimeTypes } from './uploadsCollection'

const spam = (): ResolvedSpamConfig => ({
	honeypot: false,
	rateLimit: false,
	uploadRateLimit: {
		window: 60_000,
		max: 2,
		limiter: { check: async () => ({ ok: true, remaining: 1, resetAt: 0 }) },
	},
	captcha: undefined,
	identify: () => 'ip:8.8.8.8',
	ipHeader: 'x-forwarded-for',
	metadata: { ip: false, ua: false },
})

const media = (over: Partial<CollectionConfig> = {}): CollectionConfig => ({
	slug: 'media',
	upload: true,
	fields: [],
	...over,
})

const configWith = (...collections: CollectionConfig[]): Config =>
	({ collections }) as unknown as Config

describe('attachUploadsCollection', () => {
	it('throws at boot when the slug is not in config.collections', () => {
		const config = configWith()
		expect(() => attachUploadsCollection({ config, slug: 'media', spam: false })).toThrow(
			/uploads\.collection "media" was not found/
		)
	})

	it('throws at boot when the collection has no upload config', () => {
		const config = configWith(media({ upload: undefined }))
		expect(() => attachUploadsCollection({ config, slug: 'media', spam: false })).toThrow(
			/has no `upload` config/
		)
	})

	it('appends a hidden owner text field when absent', () => {
		const config = configWith(media())
		attachUploadsCollection({ config, slug: 'media', spam: false })
		const fields = config.collections?.[0]?.fields ?? []
		expect(fields).toHaveLength(1)
		expect(fields[0]).toMatchObject({ name: 'owner', type: 'text' })
	})

	it('reuses an existing owner field instead of appending a second one', () => {
		const ownerField = { name: 'owner', type: 'text' as const }
		const config = configWith(media({ fields: [ownerField] }))
		attachUploadsCollection({ config, slug: 'media', spam: false })
		const fields = config.collections?.[0]?.fields ?? []
		expect(fields).toHaveLength(1)
		expect(fields[0]).toBe(ownerField)
	})

	it('prepends the spam hooks ahead of the host hooks', () => {
		const hostBeforeOperation = async () => undefined
		const hostBeforeValidate = async () => undefined
		const config = configWith(
			media({
				hooks: {
					beforeOperation: [hostBeforeOperation],
					beforeValidate: [hostBeforeValidate],
				},
			})
		)
		attachUploadsCollection({ config, slug: 'media', spam: spam() })
		const hooks = config.collections?.[0]?.hooks
		expect(hooks?.beforeOperation).toHaveLength(2)
		expect(hooks?.beforeOperation?.[1]).toBe(hostBeforeOperation)
		expect(hooks?.beforeValidate).toHaveLength(2)
		expect(hooks?.beforeValidate?.[1]).toBe(hostBeforeValidate)
	})

	it('leaves host hooks untouched when spam is disabled', () => {
		const hostBeforeValidate = async () => undefined
		const config = configWith(media({ hooks: { beforeValidate: [hostBeforeValidate] } }))
		attachUploadsCollection({ config, slug: 'media', spam: false })
		expect(config.collections?.[0]?.hooks?.beforeValidate).toEqual([hostBeforeValidate])
	})

	it('replaces the entry without mutating the host collection object', () => {
		const host = media()
		const config = configWith(host)
		attachUploadsCollection({ config, slug: 'media', spam: spam() })
		expect(host.fields).toHaveLength(0)
		expect(host.hooks).toBeUndefined()
		expect(config.collections?.[0]).not.toBe(host)
	})

	it('only touches the named collection', () => {
		const other = media({ slug: 'pages', upload: undefined })
		const config = configWith(other, media())
		attachUploadsCollection({ config, slug: 'media', spam: false })
		expect(config.collections?.[0]).toBe(other)
	})
})

describe('readUploadCollectionMimeTypes', () => {
	it('reads the upload collection mimeTypes', () => {
		const config = configWith(media({ upload: { mimeTypes: ['image/png', 'application/pdf'] } }))
		expect(readUploadCollectionMimeTypes(config, 'media')).toEqual(['image/png', 'application/pdf'])
	})

	it('returns undefined when upload is boolean, carries no mimeTypes, or the slug is missing', () => {
		expect(
			readUploadCollectionMimeTypes(configWith(media({ upload: true })), 'media')
		).toBeUndefined()
		expect(
			readUploadCollectionMimeTypes(configWith(media({ upload: {} })), 'media')
		).toBeUndefined()
		expect(readUploadCollectionMimeTypes(configWith(media()), 'other')).toBeUndefined()
	})
})
