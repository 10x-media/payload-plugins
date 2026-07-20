import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadLucideSource } from './lucide'

const stubFetch = (implementation: () => Promise<unknown>) => {
	vi.stubGlobal('fetch', vi.fn().mockImplementation(implementation))
}

const respondWith = (payload: unknown) => ({ ok: true, json: async () => payload })

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('loadLucideSource', () => {
	it('throws when categories cannot be fetched', async () => {
		stubFetch(() => Promise.reject(new Error('offline')))
		await expect(loadLucideSource()).rejects.toThrow(/categories unavailable/)
	})

	it('throws when the response is not an object keyed by icon name', async () => {
		stubFetch(async () => respondWith([['house', ['buildings']]]))
		await expect(loadLucideSource()).rejects.toThrow(/categories unavailable/)
	})

	it('throws when a fetch succeeds but matches no installed icon', async () => {
		stubFetch(async () => respondWith({ categories: ['buildings'] }))
		await expect(loadLucideSource()).rejects.toThrow(/matched no installed icon/)
	})

	it('emits empty categories only when explicitly allowed', async () => {
		stubFetch(() => Promise.reject(new Error('offline')))
		const source = await loadLucideSource({ allowMissingCategories: true })
		expect(source.icons.length).toBeGreaterThan(1500)
		expect(source.icons.every((icon) => icon.categories.length === 0)).toBe(true)
	})

	it('keeps only real string arrays, so array payloads cannot leak prototype methods', async () => {
		stubFetch(async () => respondWith({ house: ['buildings', 7], map: ['maps'], slice: 'nope' }))
		const source = await loadLucideSource()
		const categoriesOf = (name: string) =>
			source.icons.find((icon) => icon.name === name)?.categories
		expect(categoriesOf('house')).toEqual(['buildings'])
		expect(categoriesOf('map')).toEqual(['maps'])
		expect(categoriesOf('slice')).toEqual([])
	})
})
