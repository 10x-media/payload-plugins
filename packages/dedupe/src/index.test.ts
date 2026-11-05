import type { CollectionConfig, Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { KEYS_SLUG, PAIRS_SLUG } from './collections/slugs'
import { comparePresets, dedupe } from './index'
import { keys } from './translations'

const customers: CollectionConfig = { slug: 'customers', fields: [] }

const fakeConfig = () => ({ collections: [customers] }) as unknown as Config

describe('dedupe factory', () => {
	it('returns a Payload plugin function', () => {
		expect(typeof dedupe({})).toBe('function')
	})

	it('keeps its collections but registers nothing else when disabled', () => {
		const out = dedupe({
			disabled: true,
			collections: { customers: { match: { fields: [{ path: 'email', weight: 1 }] } } },
		})(fakeConfig()) as Config
		expect(out.collections?.map((collection) => collection.slug)).toEqual([
			'customers',
			PAIRS_SLUG,
			KEYS_SLUG,
		])
		expect(out.collections?.[0]?.hooks).toBeUndefined()
		expect(out.endpoints ?? []).toHaveLength(0)
		expect(out.jobs?.tasks ?? []).toHaveLength(0)
		expect(out.admin?.components?.views).toBeUndefined()
		expect(out.i18n).toBeUndefined()
	})

	it('registers the keys collection once when the plugin and a collection both extend it', () => {
		const out = dedupe({
			adapter: (keys) => ({ ...keys }),
			collections: {
				customers: {
					match: { fields: [{ path: 'email', weight: 1 }] },
					adapter: (base) => ({ ...base }),
				},
			},
		})(fakeConfig()) as Config
		expect(out.collections?.filter((collection) => collection.slug === KEYS_SLUG)).toHaveLength(1)
	})

	it('registers no keys collection when no matched collection searches with the keys adapter', () => {
		const register = (config: Config) => {
			config.collections = [...(config.collections ?? []), { slug: 'own-index', fields: [] }]
		}
		const slugs = (options: Parameters<typeof dedupe>[0]) =>
			(dedupe(options)(fakeConfig()) as Config).collections?.map((collection) => collection.slug)
		const match = { fields: [{ path: 'email', weight: 1 }] }

		expect(slugs({ collections: { customers: true } })).not.toContain(KEYS_SLUG)
		const own = slugs({
			collections: {
				customers: { match, adapter: () => ({ findCandidates: async () => [], register }) },
			},
		})
		expect(own).toContain('own-index')
		expect(own).not.toContain(KEYS_SLUG)
	})

	it('refuses an adapter without findCandidates, the one method the search calls', () => {
		const match = { fields: [{ path: 'email', weight: 1 }] }
		expect(() =>
			dedupe({ adapter: () => ({}) as never, collections: { customers: { match } } })(fakeConfig())
		).toThrow(/findCandidates/)
		expect(() =>
			dedupe({ collections: { customers: { match, adapter: () => ({}) as never } } })(fakeConfig())
		).toThrow(/"customers".*findCandidates/)
	})

	it('applies the translations option', () => {
		const out = dedupe({ translations: { de: { [keys.pluginName]: 'Beispiel' } } })(
			fakeConfig()
		) as Config
		const i18n = out.i18n?.translations as Record<string, Record<string, Record<string, string>>>
		expect(i18n.de?.dedupe?.pluginName).toBe('Beispiel')
		expect(i18n.en?.dedupe?.pluginName).toBe('Dedupe')
	})
})

describe('comparePresets', () => {
	it('exposes the built-in comparisons, so a compare of your own can build on them', () => {
		const umlauts = (value: unknown) => String(value).replace(/ü/g, 'ue')
		const own = {
			keys: (value: unknown) => comparePresets.text.keys(umlauts(value)),
			similarity: (a: unknown, b: unknown) =>
				comparePresets.text.similarity(umlauts(a), umlauts(b)),
		}
		expect(comparePresets.text.similarity('Jürgen Müller', 'Juergen Mueller')).toBeLessThan(1)
		expect(own.similarity('Jürgen Müller', 'Juergen Mueller')).toBe(1)
		expect(own.keys('Jürgen Müller')).toEqual(comparePresets.text.keys('Juergen Mueller'))
	})
})
