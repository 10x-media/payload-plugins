import type { CollectionConfig, Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { KEYS_SLUG, MERGES_SLUG, PAIRS_SLUG } from './collections/slugs'
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
			MERGES_SLUG,
			KEYS_SLUG,
		])
		expect(out.collections?.[0]?.hooks).toBeUndefined()
		expect(out.endpoints ?? []).toHaveLength(0)
		expect(out.jobs?.tasks ?? []).toHaveLength(0)
		expect(out.admin?.components?.views).toBeUndefined()
		expect(out.i18n).toBeUndefined()
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
