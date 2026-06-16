import { cleanup, render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { useScrollLock } from './useScrollLock'

afterEach(() => {
	cleanup()
})

const Locker = ({ active }: { active: boolean }) => {
	useScrollLock(active)
	return null
}

describe('useScrollLock', () => {
	it('sets body overflow to hidden when active', () => {
		render(createElement(Locker, { active: true }))
		expect(document.body.style.overflow).toBe('hidden')
	})

	it('restores the prior overflow value on unmount', () => {
		document.body.style.overflow = 'auto'
		const { unmount } = render(createElement(Locker, { active: true }))
		expect(document.body.style.overflow).toBe('hidden')
		unmount()
		expect(document.body.style.overflow).toBe('auto')
	})

	it('does nothing when active is false', () => {
		document.body.style.overflow = ''
		render(createElement(Locker, { active: false }))
		expect(document.body.style.overflow).toBe('')
	})
})
