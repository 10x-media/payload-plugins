import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DocumentPresence } from './DocumentPresence'

const openDrawer = vi.fn()

vi.mock('@payloadcms/ui', () => ({
	useAuth: () => ({ user: { id: 'self' } }),
	useDocumentInfo: () => ({ id: 'post-1', collectionSlug: 'posts' }),
	useConfig: () => ({
		config: {
			admin: { user: 'users' },
			routes: { admin: '/admin' },
		},
	}),
	useDocumentDrawer: () => [
		() => <div data-testid="document-drawer" />,
		() => null,
		{ openDrawer, closeDrawer: vi.fn() },
	],
}))

vi.mock('../client/useDocumentPresence', () => ({
	useDocumentPresence: () => ({
		self: { id: 'self', label: 'Me' },
		peers: [
			{ id: 'self', label: 'Me' },
			{ id: 'u2', label: 'Ada Lovelace' },
		],
		status: 'open',
	}),
}))

vi.mock('../translations/useTranslation', () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}))

afterEach(() => {
	cleanup()
	openDrawer.mockClear()
	vi.unstubAllGlobals()
})

describe('DocumentPresence', () => {
	it('shows the peer label on hover and is not a button when profile is none', () => {
		render(<DocumentPresence profile="none" />)
		const chip = screen.getByTitle('Ada Lovelace')
		expect(chip.tagName).toBe('LI')
		expect(chip.querySelector('button')).toBeNull()
	})

	it('opens the user admin document in a new tab when profile is newTab', () => {
		const open = vi.fn()
		vi.stubGlobal('open', open)
		render(<DocumentPresence profile="newTab" />)
		fireEvent.click(screen.getByRole('button', { name: 'AL' }))
		expect(open).toHaveBeenCalledWith(
			'/admin/collections/users/u2',
			'_blank',
			'noopener,noreferrer'
		)
	})

	it('opens the user document drawer when profile is drawer', () => {
		render(<DocumentPresence profile="drawer" />)
		fireEvent.click(screen.getByRole('button', { name: 'AL' }))
		expect(openDrawer).toHaveBeenCalledOnce()
	})
})
