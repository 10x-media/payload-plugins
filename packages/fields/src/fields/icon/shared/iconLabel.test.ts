import { describe, expect, it } from 'vitest'
import type { IconMeta } from '../../../types'
import { resolveIconDisplay } from './iconLabel'

const meta = (partial: Partial<IconMeta> & { name: string }): IconMeta => ({
	categories: [],
	tags: [],
	...partial,
})

describe('resolveIconDisplay', () => {
	it('derives from the name when the library supplies no label', () => {
		expect(
			resolveIconDisplay({ language: 'en', meta: meta({ name: 'arrow-up' }), name: 'arrow-up' })
		).toEqual({ label: 'Arrow up' })
	})

	it('derives from the name when no manifest entry is known at all', () => {
		expect(resolveIconDisplay({ language: 'en', name: 'arrow-up' })).toEqual({ label: 'Arrow up' })
	})

	it('prefers a library-supplied label and exposes the raw name as a code', () => {
		expect(
			resolveIconDisplay({
				language: 'en',
				meta: meta({ label: 'Hungary', name: 'HUN' }),
				name: 'HUN',
			})
		).toEqual({ code: 'HUN', label: 'Hungary' })
	})

	it('resolves a per-locale label for the admin language', () => {
		const entry = meta({ label: { de: 'Ungarn', en: 'Hungary' }, name: 'HUN' })
		expect(resolveIconDisplay({ language: 'de', meta: entry, name: 'HUN' })).toEqual({
			code: 'HUN',
			label: 'Ungarn',
		})
	})

	it('falls back to english for a language the label does not cover', () => {
		const entry = meta({ label: { de: 'Ungarn', en: 'Hungary' }, name: 'HUN' })
		expect(resolveIconDisplay({ language: 'fr', meta: entry, name: 'HUN' })).toEqual({
			code: 'HUN',
			label: 'Hungary',
		})
	})

	// A code only earns its place when it tells the editor something the label does
	// not. `ambulance` under the label `Ambulance` is noise on 1500 tooltips.
	it('omits the code when the label is what the name would have derived anyway', () => {
		expect(
			resolveIconDisplay({
				language: 'en',
				meta: meta({ label: 'Ambulance', name: 'ambulance' }),
				name: 'ambulance',
			})
		).toEqual({ label: 'Ambulance' })
	})

	it('omits the code when the label is identical to the name', () => {
		expect(
			resolveIconDisplay({ language: 'en', meta: meta({ label: 'HUN', name: 'HUN' }), name: 'HUN' })
		).toEqual({ label: 'HUN' })
	})

	it('ignores an empty label rather than announcing a blank accessible name', () => {
		expect(
			resolveIconDisplay({ language: 'en', meta: meta({ label: '', name: 'HUN' }), name: 'HUN' })
		).toEqual({ label: 'Hun' })
	})
})
