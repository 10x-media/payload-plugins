import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig, type CollectionConfig, type SanitizedConfig } from 'payload'
import { describe, expect, it } from 'vitest'
import { type FormBuilderPluginOptions, formBuilder } from '../../src/index'

/**
 * Plugins execute during config sanitization, so `buildConfig` alone exercises the boot-time
 * uploads validation without starting a database.
 */
const build = (options: FormBuilderPluginOptions, collections: CollectionConfig[] = []) =>
	buildConfig({
		secret: 'test-secret-not-for-prod',
		db: mongooseAdapter({ url: 'mongodb://localhost/never-connected' }),
		editor: lexicalEditor(),
		collections,
		plugins: [formBuilder(options)],
		typescript: { autoGenerate: false, outputFile: '/dev/null' },
		admin: { importMap: { autoGenerate: false } },
		telemetry: false,
	})

const formsBlockSlugs = (config: SanitizedConfig): string[] => {
	const forms = config.collections.find((collection) => collection.slug === 'forms')
	const slugs = new Set<string>()
	const walk = (node: unknown): void => {
		if (Array.isArray(node)) {
			for (const entry of node) {
				walk(entry)
			}
			return
		}
		if (node && typeof node === 'object') {
			const record = node as Record<string, unknown>
			if (typeof record.slug === 'string' && Array.isArray(record.fields) && 'labels' in record) {
				slugs.add(record.slug)
			}
			for (const value of Object.values(record)) {
				walk(value)
			}
		}
	}
	walk(forms?.fields)
	return [...slugs]
}

describe('form-builder uploads option', () => {
	it('throws at boot when uploads.collection is not in config.collections', async () => {
		await expect(build({ uploads: { collection: 'media' } })).rejects.toThrow(
			/uploads\.collection "media" was not found/
		)
	})

	it('throws at boot when the named collection has no upload config', async () => {
		await expect(
			build({ uploads: { collection: 'media' } }, [{ slug: 'media', fields: [] }])
		).rejects.toThrow(/has no `upload` config/)
	})

	it('accepts a host-owned upload collection and keeps the file field type', async () => {
		const config = await build({ uploads: { collection: 'media' } }, [
			{ slug: 'media', upload: true, fields: [] },
		])
		expect(formsBlockSlugs(config)).toContain('file')
	})

	it('removes the file field type from the registry by default (uploads: false)', async () => {
		const config = await build({})
		const slugs = formsBlockSlugs(config)
		expect(slugs).toContain('text')
		expect(slugs).not.toContain('file')
	})
})
