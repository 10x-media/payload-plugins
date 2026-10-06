import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { keys } from '../translations/keys'
import { AnalyticsNavLink } from './AnalyticsNavLink'

const mocks = vi.hoisted(() => ({ language: 'en', pathname: '/admin' }))

vi.mock('@payloadcms/ui', () => ({
	Link: ({
		children,
		className,
		href,
		id,
	}: {
		children: ReactNode
		className?: string
		href: string
		id?: string
	}) => (
		<a className={className} href={href} id={id}>
			{children}
		</a>
	),
	useTranslation: () => ({ i18n: { language: mocks.language }, t: (key: string) => key }),
}))

vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }))

const HREF = '/admin/analytics'

const label = () => screen.getByText(/.+/, { selector: '.nav__link-label' }).textContent

beforeEach(() => {
	mocks.language = 'en'
	mocks.pathname = '/admin'
})

afterEach(() => {
	cleanup()
})

describe('AnalyticsNavLink label', () => {
	it('uses a plain string override as-is', () => {
		render(<AnalyticsNavLink href={HREF} label="Traffic" />)
		expect(label()).toBe('Traffic')
	})

	it('picks the admin language out of a locale map', () => {
		mocks.language = 'de'
		render(<AnalyticsNavLink href={HREF} label={{ de: 'Verkehr', en: 'Traffic' }} />)
		expect(label()).toBe('Verkehr')
	})

	it('falls back to en when the map has no entry for the admin language', () => {
		mocks.language = 'ko'
		render(<AnalyticsNavLink href={HREF} label={{ de: 'Verkehr', en: 'Traffic' }} />)
		expect(label()).toBe('Traffic')
	})

	it('falls back to the translated label with no override at all', () => {
		render(<AnalyticsNavLink href={HREF} />)
		expect(label()).toBe(keys.viewNavLabel)
	})

	it('treats a blank override as unset rather than rendering an empty entry', () => {
		render(<AnalyticsNavLink href={HREF} label="   " />)
		expect(label()).toBe(keys.viewNavLabel)
	})
})

describe('AnalyticsNavLink active state', () => {
	it('renders a link with no indicator elsewhere in the admin', () => {
		const { container } = render(<AnalyticsNavLink href={HREF} />)
		const link = container.querySelector('a.nav__link')
		expect(link?.getAttribute('href')).toBe(HREF)
		expect(container.querySelector('.nav__link-indicator')).toBeNull()
	})

	it('renders an inert div with an indicator on the view itself', () => {
		mocks.pathname = HREF
		const { container } = render(<AnalyticsNavLink href={HREF} />)
		expect(container.querySelector('a')).toBeNull()
		expect(container.querySelector('div.nav__link')).not.toBeNull()
		expect(container.querySelector('.nav__link-indicator')).not.toBeNull()
	})

	it('stays a link but marks itself active on a nested path under the view', () => {
		mocks.pathname = `${HREF}/pages`
		const { container } = render(<AnalyticsNavLink href={HREF} />)
		expect(container.querySelector('a.nav__link')).not.toBeNull()
		expect(container.querySelector('.nav__link-indicator')).not.toBeNull()
	})

	it('does not match a sibling route that merely shares the prefix', () => {
		mocks.pathname = `${HREF}-settings`
		const { container } = render(<AnalyticsNavLink href={HREF} />)
		expect(container.querySelector('.nav__link-indicator')).toBeNull()
	})
})
