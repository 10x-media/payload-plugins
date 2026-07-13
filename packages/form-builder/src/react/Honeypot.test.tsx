import { cleanup, render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, expect, it } from 'vitest'
import { Honeypot } from './Honeypot'

afterEach(cleanup)

it('renders an aria-hidden, off-tab decoy input with the given name', () => {
	const { container } = render(createElement(Honeypot, { name: 'website' }))
	const wrapper = container.querySelector('[aria-hidden="true"]')
	expect(wrapper).not.toBeNull()
	const input = container.querySelector('input')
	expect(input?.getAttribute('name')).toBe('website')
	expect(input?.getAttribute('tabindex')).toBe('-1')
	expect(input?.getAttribute('autocomplete')).toBe('new-password')
})
