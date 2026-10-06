import type { CollectionConfig, Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { KEYS_SLUG, PAIRS_SLUG } from './collections/slugs'
import { dedupe } from './index'
import { keys } from './translations'

const customers: CollectionConfig = { slug: 'customers', fields: [] }

const fakeConfig = () => ({ collections: [customers] }) as unknown as Config

describe('dedupe factory', () => {
	it('returns a Payload plugin function', () => {
		expect(typeof dedupe({})).toBe('function')
	})

	it('keeps its collections but registers nothing else when disabled', () => {
		const out = dedupe({ disabled: true, collections: { customers: true } })(fakeConfig()) as Config
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
