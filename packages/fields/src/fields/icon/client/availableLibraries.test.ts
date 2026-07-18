import { describe, expect, it } from 'vitest'
import {
	filterAvailableLibraries,
	type LibraryOption,
	pickInitialLibrary,
} from './availableLibraries'

const adapters: LibraryOption[] = [
	{ label: 'Lucide', slug: 'lucide' },
	{ label: 'Radix', slug: 'radix' },
	{ label: 'Tabler', slug: 'tabler' },
]

describe('filterAvailableLibraries', () => {
	it('keeps only registered adapters that are available', () => {
		expect(filterAvailableLibraries(adapters, ['lucide', 'tabler'])).toEqual([
			{ label: 'Lucide', slug: 'lucide' },
			{ label: 'Tabler', slug: 'tabler' },
		])
	})

	it('ignores available slugs with no registered adapter', () => {
		expect(filterAvailableLibraries(adapters, ['lucide', 'ghost'])).toEqual([
			{ label: 'Lucide', slug: 'lucide' },
		])
	})

	it('returns nothing when none are available', () => {
		expect(filterAvailableLibraries(adapters, [])).toEqual([])
	})
})

describe('pickInitialLibrary', () => {
	it('opens on the stored library when it is still available', () => {
		expect(
			pickInitialLibrary({
				available: ['lucide', 'tabler'],
				defaultLibrary: 'lucide',
				selectedLibrary: 'tabler',
			})
		).toBe('tabler')
	})

	it('falls back to the default library when the stored one is unavailable', () => {
		expect(
			pickInitialLibrary({
				available: ['lucide', 'tabler'],
				defaultLibrary: 'lucide',
				selectedLibrary: 'radix',
			})
		).toBe('lucide')
	})

	it('falls back to the first available library when the default is unavailable', () => {
		expect(
			pickInitialLibrary({
				available: ['tabler'],
				defaultLibrary: 'lucide',
				selectedLibrary: null,
			})
		).toBe('tabler')
	})

	it('degrades to the default library when nothing is available', () => {
		expect(
			pickInitialLibrary({ available: [], defaultLibrary: 'lucide', selectedLibrary: null })
		).toBe('lucide')
	})
})
