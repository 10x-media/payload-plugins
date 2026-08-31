import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { keys } from '../translations/keys'
import { DocumentConflict } from './DocumentConflict'

const { dismiss, state, conflictHook } = vi.hoisted(() => {
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
		conflictHook: vi.fn(),
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
	useDocumentConflict: (opts: unknown) => {
		conflictHook(opts)
		return { conflict: state.conflict, dismiss }
	},
}))

vi.mock('../translations/useTranslation', () => ({
	useTranslation: () => ({
		t: (key: string) => key,
	}),
}))

beforeEach(() => {
	const controls = document.createElement('div')
	controls.className = 'doc-controls'
	document.body.appendChild(controls)
})

afterEach(() => {
	cleanup()
	dismiss.mockClear()
	conflictHook.mockClear()
	state.formModified = true
	state.conflict = {
		id: 'e1',
		operation: 'update',
		actorId: 'other',
	}
	document.querySelectorAll('.doc-controls, .sse-document-conflict-host').forEach((el) => {
		el.remove()
	})
	vi.unstubAllGlobals()
})

describe('DocumentConflict', () => {
	it('portals the banner after .doc-controls, not into the toolbar slot', () => {
		const { container } = render(<DocumentConflict />)
		const controls = document.querySelector('.doc-controls')
		const banner = screen.getByRole('status')
		expect(container.firstChild).toBeNull()
		expect(controls?.contains(banner)).toBe(false)
		expect(controls?.nextElementSibling?.contains(banner)).toBe(true)
	})

	it('passes document identity and form modified into the hook', () => {
		render(<DocumentConflict />)
		expect(conflictHook).toHaveBeenCalledWith(
			expect.objectContaining({
				collection: 'posts',
				id: 'post-1',
				selfId: 'self',
				modified: true,
			})
		)
	})

	it('renders update copy and Reload reloads the window', () => {
		render(<DocumentConflict />)
		expect(screen.getByText(keys.conflictUpdated)).toBeTruthy()
		const reload = vi.fn()
		vi.stubGlobal('location', { reload })
		fireEvent.click(screen.getByRole('button', { name: keys.conflictReload }))
		expect(reload).toHaveBeenCalledOnce()
	})

	it('renders delete copy and Keep editing dismisses as the first action', () => {
		state.conflict = { id: 'd1', operation: 'delete' }
		render(<DocumentConflict />)
		expect(screen.getByText(keys.conflictDeleted)).toBeTruthy()
		const buttons = screen.getAllByRole('button')
		expect(buttons[0]).toHaveTextContent(keys.conflictKeepEditing)
		fireEvent.click(screen.getByRole('button', { name: keys.conflictKeepEditing }))
		expect(dismiss).toHaveBeenCalledOnce()
	})

	it('renders nothing when there is no conflict', () => {
		state.conflict = null
		const { container } = render(<DocumentConflict />)
		expect(container.firstChild).toBeNull()
		expect(screen.queryByRole('status')).toBeNull()
	})
})
