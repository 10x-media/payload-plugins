import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { keys } from '../translations/keys'
import { DocumentPresence } from './DocumentPresence'

const { openDrawer, presenceHook, state } = vi.hoisted(() => {
	const peers: Array<{ id: string; label: string; mode: 'viewing' | 'editing' }> = [
		{ id: 'self', label: 'Me', mode: 'viewing' },
		{ id: 'u2', label: 'Ada Lovelace', mode: 'viewing' },
	]
	return {
		openDrawer: vi.fn(),
		presenceHook: vi.fn(),
		state: {
			formModified: false,
			peers,
		},
	}
})

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
	useFormModified: () => state.formModified,
}))

vi.mock('../client/useDocumentPresence', () => ({
	useDocumentPresence: (...args: unknown[]) => {
		presenceHook(...args)
		return {
			self: { id: 'self', label: 'Me', mode: 'viewing' },
			peers: state.peers,
			status: 'open',
		}
	},
}))

vi.mock('../translations/useTranslation', () => ({
	useTranslation: () => ({
		t: (key: string, vars?: { name?: string; other?: string; count?: number }) => {
			if (!vars) return key
			return [key, vars.name, vars.other, vars.count].filter((part) => part != null).join(':')
		},
	}),
}))

afterEach(() => {
	cleanup()
	openDrawer.mockClear()
	presenceHook.mockClear()
	state.formModified = false
	state.peers = [
		{ id: 'self', label: 'Me', mode: 'viewing' },
		{ id: 'u2', label: 'Ada Lovelace', mode: 'viewing' },
	]
	vi.unstubAllGlobals()
})

describe('DocumentPresence', () => {
	it('shows the peer label on hover and is not a button when profile is none', () => {
		render(<DocumentPresence profile="none" />)
		const chip = screen.getByTitle('Ada Lovelace')
		expect(chip.tagName).toBe('LI')
		expect(chip.querySelector('button')).toBeNull()
		expect(chip.className).not.toContain('sse-document-presence-chip--editing')
		expect(screen.getByText(keys.alsoViewing)).toBeTruthy()
	})

	it('marks an editing peer and switches the caption', () => {
		state.peers = [
			{ id: 'self', label: 'Me', mode: 'viewing' },
			{ id: 'u2', label: 'Ada Lovelace', mode: 'editing' },
		]
		render(<DocumentPresence profile="none" />)
		const chip = screen.getByTitle(`Ada Lovelace (${keys.editing})`)
		expect(chip.className).toContain('sse-document-presence-chip--editing')
		expect(screen.getByText(`${keys.isEditing}:Ada Lovelace`)).toBeTruthy()
	})

	it('captions two editors and N others', () => {
		state.peers = [
			{ id: 'self', label: 'Me', mode: 'viewing' },
			{ id: 'u2', label: 'Ada Lovelace', mode: 'editing' },
			{ id: 'u3', label: 'Bob', mode: 'editing' },
		]
		const { rerender } = render(<DocumentPresence profile="none" />)
		expect(screen.getByText(`${keys.areEditing}:Ada Lovelace:Bob`)).toBeTruthy()
		state.peers = [
			{ id: 'self', label: 'Me', mode: 'viewing' },
			{ id: 'u2', label: 'Ada Lovelace', mode: 'editing' },
			{ id: 'u3', label: 'Bob', mode: 'editing' },
			{ id: 'u4', label: 'Cara', mode: 'editing' },
		]
		rerender(<DocumentPresence profile="none" />)
		expect(screen.getByText(`${keys.areEditingMany}:Ada Lovelace:2`)).toBeTruthy()
	})

	it('POSTs viewing by default and editing when the form is modified', () => {
		const { rerender } = render(<DocumentPresence profile="none" />)
		expect(presenceHook).toHaveBeenCalledWith(
			'posts',
			'post-1',
			expect.objectContaining({ mode: 'viewing' })
		)
		presenceHook.mockClear()
		state.formModified = true
		rerender(<DocumentPresence profile="none" />)
		expect(presenceHook).toHaveBeenCalledWith(
			'posts',
			'post-1',
			expect.objectContaining({ mode: 'editing' })
		)
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
