import { describe, expect, it } from 'vitest'
import { staticSource } from './static'

const args = { payload: {} as never, locale: 'en' }

describe('staticSource', () => {
	it('has type "static"', () => {
		expect(staticSource.type).toBe('static')
	})

	it('returns configured label and url as a link', () => {
		const result = staticSource.resolve({ ...args, config: { label: 'Privacy', url: '/privacy' } })
		expect(result).toEqual({ links: [{ label: 'Privacy', url: '/privacy' }] })
	})

	it('includes versionRef and versionLabel when version is set', () => {
		const result = staticSource.resolve({
			...args,
			config: { label: 'Terms', url: '/terms', version: 'v2' },
		})
		expect(result).toEqual({
			links: [{ label: 'Terms', url: '/terms' }],
			versionRef: 'v2',
			versionLabel: 'v2',
		})
	})

	it('omits version fields when version is not set', () => {
		const result = staticSource.resolve({ ...args, config: { label: 'TOS', url: '/tos' } })
		expect(result).not.toHaveProperty('versionRef')
		expect(result).not.toHaveProperty('versionLabel')
	})

	it('returns empty-string link when label is missing', () => {
		const result = staticSource.resolve({ ...args, config: { url: '/privacy' } })
		expect(result).toEqual({ links: [{ label: '', url: '/privacy' }] })
	})

	it('returns empty-string link when url is missing', () => {
		const result = staticSource.resolve({ ...args, config: { label: 'Privacy' } })
		expect(result).toEqual({ links: [{ label: 'Privacy', url: '' }] })
	})

	it('returns empty-string link when both label and url are missing', () => {
		const result = staticSource.resolve({ ...args, config: {} })
		expect(result).toEqual({ links: [{ label: '', url: '' }] })
	})

	it('coerces numeric values via String()', () => {
		const result = staticSource.resolve({
			...args,
			config: { label: 42 as never, url: 0 as never },
		})
		expect(result).toEqual({ links: [{ label: '42', url: '0' }] })
	})
})
