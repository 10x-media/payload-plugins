import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FormFieldInstance } from '../submissions/types'
import { Form, type FormDocument } from './Form'
import { Poll } from './Poll'

afterEach(() => {
	cleanup()
	window.localStorage.clear()
})

const lexical = (text: string) => ({
	root: {
		type: 'root',
		children: [{ type: 'paragraph', children: [{ type: 'text', text }] }],
	},
})

const nameField: FormFieldInstance[] = [{ blockType: 'text', name: 'name', label: 'Name' }]

const doc = (extra?: Partial<FormDocument>): FormDocument => ({
	id: 1,
	fields: nameField,
	multistep: false,
	pollEnabled: false,
	...extra,
})

const redirectDoc = (url = 'https://example.com/thanks'): FormDocument =>
	doc({ response: { type: 'redirect', redirect: { url } } })

/** Stubs window.location with an assign/replace spy pair for the duration of `run`. */
const withLocationSpies = async (
	run: (spies: {
		assign: ReturnType<typeof vi.fn>
		replace: ReturnType<typeof vi.fn>
	}) => Promise<void>
) => {
	const assign = vi.fn()
	const replace = vi.fn()
	const originalLocation = window.location
	Object.defineProperty(window, 'location', {
		configurable: true,
		value: { ...originalLocation, assign, replace },
	})
	try {
		await run({ assign, replace })
	} finally {
		Object.defineProperty(window, 'location', {
			configurable: true,
			value: originalLocation,
		})
	}
}

const submitOk = () => vi.fn().mockResolvedValue({ ok: true, submissionId: '7' })

describe('Form adapters.navigate', () => {
	it('calls navigate exactly once with the resolved URL and skips window.location', async () => {
		await withLocationSpies(async ({ assign, replace }) => {
			const navigate = vi.fn()
			render(<Form form={redirectDoc()} onSubmit={submitOk()} adapters={{ navigate }} />)

			fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

			await waitFor(() => {
				expect(navigate).toHaveBeenCalledTimes(1)
			})
			expect(navigate).toHaveBeenCalledWith('https://example.com/thanks', { replace: false })
			expect(assign).not.toHaveBeenCalled()
			expect(replace).not.toHaveBeenCalled()
		})
	})

	it('keeps window.location.assign when no adapters are given', async () => {
		await withLocationSpies(async ({ assign }) => {
			render(<Form form={redirectDoc()} onSubmit={submitOk()} />)

			fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

			await waitFor(() => {
				expect(assign).toHaveBeenCalledWith('https://example.com/thanks')
			})
		})
	})

	it('does not call navigate for a message response', async () => {
		const navigate = vi.fn()
		const form = doc({ response: { type: 'message', message: lexical('Done') } })
		render(<Form form={form} onSubmit={submitOk()} adapters={{ navigate }} />)

		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

		await screen.findByRole('status')
		expect(navigate).not.toHaveBeenCalled()
	})

	it('does not call navigate for a redirect with an empty url', async () => {
		const navigate = vi.fn()
		const onSuccess = vi.fn()
		const form = doc({ response: { type: 'redirect', redirect: { url: '' } } })
		render(<Form form={form} onSubmit={submitOk()} adapters={{ navigate }} onSuccess={onSuccess} />)

		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

		await waitFor(() => {
			expect(onSuccess).toHaveBeenCalled()
		})
		expect(navigate).not.toHaveBeenCalled()
	})

	it('does not call navigate on a failed submit', async () => {
		const navigate = vi.fn()
		const onSubmit = vi.fn().mockResolvedValue({ ok: false, message: 'nope' })
		render(<Form form={redirectDoc()} onSubmit={onSubmit} adapters={{ navigate }} />)

		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

		await screen.findByRole('alert')
		expect(navigate).not.toHaveBeenCalled()
	})

	it('fires after onSuccess, and after onClose under dismissOnSuccess', async () => {
		const order: string[] = []
		const navigate = vi.fn(() => order.push('navigate'))
		const onSuccess = vi.fn(() => order.push('success'))
		const onClose = vi.fn(() => order.push('close'))
		render(
			<Form
				form={redirectDoc()}
				onSubmit={submitOk()}
				adapters={{ navigate }}
				onSuccess={onSuccess}
				onClose={onClose}
				presentation={{
					name: 'test-overlay',
					label: 'Test',
					surface: 'overlay',
					density: 'comfortable',
					dismissOnSuccess: true,
				}}
			/>
		)

		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

		await waitFor(() => {
			expect(navigate).toHaveBeenCalled()
		})
		expect(order).toEqual(['success', 'close', 'navigate'])
	})

	it('fires under successBehavior reset', async () => {
		const navigate = vi.fn()
		render(
			<Form
				form={redirectDoc()}
				onSubmit={submitOk()}
				adapters={{ navigate }}
				successBehavior="reset"
			/>
		)

		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

		await waitFor(() => {
			expect(navigate).toHaveBeenCalledWith('https://example.com/thanks', { replace: false })
		})
	})

	it('propagates a throwing navigate without falling back to window.location', async () => {
		await withLocationSpies(async ({ assign, replace }) => {
			const prior = process.listeners('unhandledRejection')
			process.removeAllListeners('unhandledRejection')
			const captured: unknown[] = []
			const capture = (reason: unknown) => {
				captured.push(reason)
			}
			process.on('unhandledRejection', capture)
			try {
				const navigate = vi.fn(() => {
					throw new Error('router exploded')
				})
				render(<Form form={redirectDoc()} onSubmit={submitOk()} adapters={{ navigate }} />)

				fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

				await waitFor(() => {
					expect(navigate).toHaveBeenCalled()
				})
				await new Promise((resolve) => setTimeout(resolve, 0))
				expect(assign).not.toHaveBeenCalled()
				expect(replace).not.toHaveBeenCalled()
				expect(captured).toHaveLength(1)
				expect(captured[0]).toBeInstanceOf(Error)
			} finally {
				process.off('unhandledRejection', capture)
				for (const listener of prior) {
					process.on('unhandledRejection', listener)
				}
			}
		})
	})
})

describe('Poll adapters forwarding', () => {
	const pollForm: FormDocument = {
		id: 1,
		multistep: false,
		pollEnabled: true,
		fields: [
			{
				blockType: 'select',
				name: 'colour',
				label: 'Colour',
				options: [
					{ label: 'Red', value: 'red' },
					{ label: 'Blue', value: 'blue' },
				],
			},
		],
		response: { type: 'redirect', redirect: { url: 'https://example.com/voted' } },
	}

	it('forwards adapters to the inner Form so navigate handles the poll redirect', async () => {
		await withLocationSpies(async ({ assign }) => {
			const navigate = vi.fn()
			const fetchResultsImpl = vi.fn().mockResolvedValue({ ok: true, results: [] })
			const { container } = render(
				<Poll
					form={pollForm}
					resultsField="colour"
					onSubmit={submitOk()}
					fetchResultsImpl={fetchResultsImpl}
					adapters={{ navigate }}
				/>
			)

			fireEvent.change(within(container).getByRole('combobox'), { target: { value: 'red' } })
			fireEvent.click(within(container).getByRole('button', { name: /submit|vote/i }))

			await waitFor(() => {
				expect(navigate).toHaveBeenCalledWith('https://example.com/voted', { replace: false })
			})
			expect(assign).not.toHaveBeenCalled()
		})
	})
})
