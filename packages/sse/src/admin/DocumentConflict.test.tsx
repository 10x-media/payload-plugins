import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { keys } from '../translations/keys'
import { DocumentConflict } from './DocumentConflict'

const { dismiss, state } = vi.hoisted(() => {
	const conflict: {
		id: string
		operation: 'update' | 'delete'
		actorId?: string
	} | null = {
		id: 'e1',
		operation: 'update',
		actorId: 'other',
	}
	return {
		dismiss: vi.fn(),
		state: {
			formModified: true,
			conflict: conflict as {
				id: string
				operation: 'update' | 'delete'
				actorId?: string
			} | null,
		},
	}
})

vi.mock('@payloadcms/ui', () => ({
	useAuth: () => ({ user: { id: 'self' } }),
	useDocumentInfo: () => ({ id: 'post-1', collectionSlug: 'posts' }),
	useFormModified: () => state.formModified,
}))

vi.mock('../client/useDocumentConflict', () => ({
	useDocumentConflict: () => ({ conflict: state.conflict, dismiss }),
}))

vi.mock('../translations/useTranslation', () => ({
	useTranslation: () => ({
		t: (key: string) => key,
	}),
}))

afterEach(() => {
	cleanup()
	dismiss.mockClear()
	state.formModified = true
	state.conflict = {
		id: 'e1',
		operation: 'update',
		actorId: 'other',
	}
	vi.unstubAllGlobals()
})

describe('DocumentConflict', () => {
	it('renders update copy and Reload reloads the window', () => {
		render(<DocumentConflict />)
		expect(screen.getByText(keys.conflictUpdated)).toBeTruthy()
		const reload = vi.fn()
		vi.stubGlobal('location', { reload })
		fireEvent.click(screen.getByRole('button', { name: keys.conflictReload }))
		expect(reload).toHaveBeenCalledOnce()
	})

	it('renders delete copy and Keep editing dismisses', () => {
		state.conflict = { id: 'd1', operation: 'delete' }
		render(<DocumentConflict />)
		expect(screen.getByText(keys.conflictDeleted)).toBeTruthy()
		fireEvent.click(screen.getByRole('button', { name: keys.conflictKeepEditing }))
		expect(dismiss).toHaveBeenCalledOnce()
	})

	it('renders nothing when there is no conflict', () => {
		state.conflict = null
		const { container } = render(<DocumentConflict />)
		expect(container.firstChild).toBeNull()
	})
})
