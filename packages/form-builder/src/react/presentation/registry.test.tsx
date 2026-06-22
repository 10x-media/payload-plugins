import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultPresentations } from './presentations'
import { resolvePresentations } from './registry'
import type { FormPresentation } from './types'

afterEach(() => cleanup())

describe('resolvePresentations', () => {
	it('returns the four built-ins; page/inline have no Wrapper, modal/drawer do', () => {
		const r = resolvePresentations(defaultPresentations)
		expect([...r.keys()].sort()).toEqual(['drawer', 'inline', 'modal', 'page'])
		expect(r.get('page')?.Wrapper).toBeUndefined()
		expect(r.get('inline')?.Wrapper).toBeUndefined()
		expect(typeof r.get('modal')?.Wrapper).toBe('function')
		expect(typeof r.get('drawer')?.Wrapper).toBe('function')
	})

	it('false removes, true keeps', () => {
		const r = resolvePresentations(defaultPresentations, { modal: false, page: true })
		expect(r.has('modal')).toBe(false)
		expect(r.has('page')).toBe(true)
	})

	it('an object adds or replaces with a custom Wrapper', () => {
		const custom: FormPresentation = {
			name: 'sheet',
			label: 'Sheet',
			surface: 'overlay',
			density: 'comfortable',
			Wrapper: ({ children }) => children as never,
		}
		const r = resolvePresentations(defaultPresentations, { sheet: custom })
		expect(r.get('sheet')).toBe(custom)
	})
})
