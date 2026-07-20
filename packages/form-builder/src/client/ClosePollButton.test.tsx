import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { keys } from '../translations/keys'
import { ClosePollButton } from './ClosePollButton'

const mock = vi.hoisted(() => ({
	id: 'form-1' as string | number | null | undefined,
	fields: {} as Record<string, { value: unknown }>,
	getDataByPath: vi.fn((_path: string): unknown => ({})),
	submit: vi.fn(async (_options?: unknown): Promise<void> => undefined),
}))

vi.mock('@payloadcms/ui', () => ({
	Button: ({
		children,
		onClick,
		disabled,
	}: {
		children?: ReactNode
		onClick?: () => void
		disabled?: boolean
	}) => (
		<button type="button" disabled={disabled} onClick={onClick}>
			{children}
		</button>
	),
	useDocumentInfo: () => ({ id: mock.id }),
	useForm: () => ({ getDataByPath: mock.getDataByPath, submit: mock.submit }),
	useFormFields: (selector: (args: [Record<string, { value: unknown }>]) => unknown) =>
		selector([mock.fields]),
}))

vi.mock('../translations/useTranslation', () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}))

const setPoll = (over: { type?: string; closesAt?: unknown; winningValues?: unknown }): void => {
	mock.fields = {
		'poll.type': { value: over.type ?? 'manual' },
		'poll.closesAt': { value: over.closesAt ?? null },
		'poll.outcome.winningValues': { value: over.winningValues ?? [] },
	}
}

const button = (root: HTMLElement): HTMLButtonElement => {
	const el = root.querySelector('button')
	if (!el) {
		throw new Error('button missing')
	}
	return el
}

const hint = (root: HTMLElement): string | null | undefined =>
	root.querySelector('.field-description')?.textContent

const overridePoll = (): Record<string, unknown> => {
	const arg = mock.submit.mock.calls[0]?.[0] as
		| { overrides?: { poll?: Record<string, unknown> } }
		| undefined
	return arg?.overrides?.poll ?? {}
}

afterEach(() => {
	cleanup()
	vi.clearAllMocks()
	mock.id = 'form-1'
	mock.fields = {}
	mock.getDataByPath.mockImplementation(() => ({}))
})

describe('ClosePollButton', () => {
	it('disables Close for a manual poll with no winner, hinting to pick one first', () => {
		setPoll({ type: 'manual', winningValues: [] })
		const { container } = render(<ClosePollButton />)
		expect(button(container).textContent).toBe(keys.pollCloseButton)
		expect(button(container).disabled).toBe(true)
		expect(hint(container)).toBe(keys.pollCloseNeedsWinner)
	})

	it('enables Close for a manual poll once a winner is selected', () => {
		setPoll({ type: 'manual', winningValues: ['red'] })
		const { container } = render(<ClosePollButton />)
		expect(button(container).textContent).toBe(keys.pollCloseButton)
		expect(button(container).disabled).toBe(false)
		expect(hint(container)).toBe(keys.pollCloseHintManual)
	})

	it('enables Close for a mostVoted poll with no winner (server-computed on close)', () => {
		setPoll({ type: 'mostVoted', winningValues: [] })
		const { container } = render(<ClosePollButton />)
		expect(button(container).textContent).toBe(keys.pollCloseButton)
		expect(button(container).disabled).toBe(false)
		expect(hint(container)).toBe(keys.pollCloseHintMostVoted)
	})

	it('shows Reopen (enabled) once a closesAt is set, with the reopen hint', () => {
		setPoll({ type: 'mostVoted', closesAt: new Date().toISOString(), winningValues: ['red'] })
		const { container } = render(<ClosePollButton />)
		expect(button(container).textContent).toBe(keys.pollReopenButton)
		expect(button(container).disabled).toBe(false)
		expect(hint(container)).toBe(keys.pollReopenHint)
	})

	it('disables the button on an unsaved document', () => {
		mock.id = null
		setPoll({ type: 'mostVoted' })
		const { container } = render(<ClosePollButton />)
		expect(button(container).disabled).toBe(true)
	})

	it('closes by saving the whole poll with closesAt set, preserving the picked winner', async () => {
		setPoll({ type: 'manual', winningValues: ['red'] })
		mock.getDataByPath.mockImplementation(() => ({
			resultsField: 'colour',
			type: 'manual',
			outcome: { winningValues: ['red'] },
		}))
		const { container } = render(<ClosePollButton />)
		fireEvent.click(button(container))
		await waitFor(() => expect(mock.submit).toHaveBeenCalledTimes(1))
		const poll = overridePoll()
		expect(poll.outcome).toEqual({ winningValues: ['red'] })
		expect(typeof poll.closesAt).toBe('string')
	})

	it('reopens by clearing both closesAt and winningValues', async () => {
		setPoll({ type: 'mostVoted', closesAt: new Date().toISOString(), winningValues: ['red'] })
		mock.getDataByPath.mockImplementation(() => ({
			resultsField: 'colour',
			type: 'mostVoted',
			closesAt: '2020-01-01T00:00:00.000Z',
			outcome: { winningValues: ['red'], resolvedAt: '2020-01-01T00:00:00.000Z' },
		}))
		const { container } = render(<ClosePollButton />)
		fireEvent.click(button(container))
		await waitFor(() => expect(mock.submit).toHaveBeenCalledTimes(1))
		const poll = overridePoll()
		expect(poll.closesAt).toBeNull()
		expect((poll.outcome as { winningValues: unknown }).winningValues).toEqual([])
	})
})
