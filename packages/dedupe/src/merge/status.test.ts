import { describe, expect, it } from 'vitest'

import type { CollectionContext } from '../plugin/context'
import { draftLocales } from './status'

const col = {
	config: { versions: { drafts: { localizeStatus: true } } },
	hasDrafts: true,
	options: { draft: false },
} as unknown as Pick<CollectionContext, 'config' | 'hasDrafts' | 'options'>

describe('draftLocales', () => {
	it('names the locales stored as drafts, as MongoDB reads them', () => {
		const survivor = { _status: { en: 'published', de: 'draft' } }
		expect(draftLocales(col, survivor, ['en', 'de'])).toEqual(['de'])
	})

	it('counts a locale missing from the status as a draft, as SQL reads one never written', () => {
		const survivor = { _status: { en: 'published' } }
		expect(draftLocales(col, survivor, ['en', 'de'])).toEqual(['de'])
	})

	it('names none for a merge of drafts or a status shared by every locale', () => {
		const survivor = { _status: { en: 'published' } }
		const drafts = { ...col, options: { draft: true } } as typeof col
		expect(draftLocales(drafts, survivor, ['en', 'de'])).toEqual([])
		const shared = { ...col, config: { versions: { drafts: true } } } as unknown as typeof col
		expect(draftLocales(shared, survivor, ['en', 'de'])).toEqual([])
	})
})
