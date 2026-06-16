import { describe, expect, it } from 'vitest'
import { defaultPresentationDescriptors } from './defaults'
import { resolvePresentationDescriptors } from './registry'

describe('resolvePresentationDescriptors', () => {
	it('returns the four built-ins by default', () => {
		const r = resolvePresentationDescriptors(defaultPresentationDescriptors)
		expect([...r.keys()].sort()).toEqual(['drawer', 'inline', 'modal', 'page'])
	})

	it('false removes a built-in', () => {
		const r = resolvePresentationDescriptors(defaultPresentationDescriptors, { drawer: false })
		expect(r.has('drawer')).toBe(false)
	})

	it('true keeps the default', () => {
		const r = resolvePresentationDescriptors(defaultPresentationDescriptors, { modal: true })
		expect(r.get('modal')?.surface).toBe('overlay')
	})

	it('an object adds or replaces', () => {
		const r = resolvePresentationDescriptors(defaultPresentationDescriptors, {
			fullscreen: {
				name: 'fullscreen',
				label: 'Fullscreen',
				surface: 'overlay',
				density: 'compact',
			},
			page: { name: 'page', label: 'Page', surface: 'page', density: 'compact' },
		})
		expect(r.get('fullscreen')?.density).toBe('compact')
		expect(r.get('page')?.density).toBe('compact')
	})
})
