import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BodyConverter } from '../actions/body/converters'
import type { FormFieldInstance } from '../submissions/types'
import { Form, type FormDocument } from './Form'

afterEach(() => {
	cleanup()
})

const lexical = (text: string) => ({
	root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text }] }] },
})

const doc = (fields: FormFieldInstance[], extra?: Partial<FormDocument>): FormDocument => ({
	id: 1,
	fields,
	multistep: false,
	pollEnabled: false,
	...extra,
})

const oneField: FormFieldInstance[] = [{ blockType: 'text', name: 'first', label: 'First' }]

describe('Form success handling', () => {
	it('passes the recall-resolved response html to onSuccess', async () => {
		const onSuccess = vi.fn()
		const form = doc(oneField, {
			response: { type: 'message', message: lexical('Thanks {{first}}') },
		})
		render(
			<Form
				form={form}
				onSubmit={vi.fn().mockResolvedValue({ ok: true, submissionId: 's1' })}
				onSuccess={onSuccess}
			/>
		)
		fireEvent.change(screen.getByLabelText('First'), { target: { value: 'Ada' } })
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

		await waitFor(() => expect(onSuccess).toHaveBeenCalled())
		const [submissionId, result] = onSuccess.mock.calls[0] ?? []
		expect(submissionId).toBe('s1')
		expect(result?.response?.type).toBe('message')
		expect(result?.response?.html).toContain('Thanks Ada')
	})

	it('reports a redirect response to onSuccess', async () => {
		const onSuccess = vi.fn()
		const form = doc(oneField, {
			response: { type: 'redirect', redirect: { url: 'https://example.com/thanks' } },
		})
		render(
			<Form form={form} onSubmit={vi.fn().mockResolvedValue({ ok: true })} onSuccess={onSuccess} />
		)
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

		await waitFor(() => expect(onSuccess).toHaveBeenCalled())
		expect((onSuccess.mock.calls[0] ?? [])[1]?.response).toEqual({
			type: 'redirect',
			url: 'https://example.com/thanks',
		})
	})

	it('applies custom converters (host blocks) to the resolved response', async () => {
		const onSuccess = vi.fn()
		const converters: Record<string, BodyConverter> = {
			badge: ({ node }) => `<b class="badge">${String(node.label)}</b>`,
		}
		const message = { root: { type: 'root', children: [{ type: 'badge', label: 'NEW' }] } }
		render(
			<Form
				form={doc(oneField, { response: { type: 'message', message } })}
				onSubmit={vi.fn().mockResolvedValue({ ok: true })}
				onSuccess={onSuccess}
				converters={converters}
			/>
		)
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

		await waitFor(() => expect(onSuccess).toHaveBeenCalled())
		// Default converters would drop the unknown `badge` block; the host converter keeps it.
		expect((onSuccess.mock.calls[0] ?? [])[1]?.response?.html).toContain('<b class="badge">NEW</b>')
	})

	it('resets the form in place on success when successBehavior is reset, showing no success screen', async () => {
		const onSuccess = vi.fn()
		render(
			<Form
				form={doc(oneField)}
				onSubmit={vi.fn().mockResolvedValue({ ok: true, submissionId: 's2' })}
				onSuccess={onSuccess}
				successBehavior="reset"
			/>
		)
		fireEvent.change(screen.getByLabelText('First'), { target: { value: 'Ada' } })
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

		await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('s2', expect.anything()))
		// The form stays (no success status), and the field is cleared for reuse.
		expect(screen.queryByRole('status')).toBeNull()
		expect(screen.getByLabelText('First')).toHaveValue('')
		expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument()
	})

	it('replaces the form with the success screen by default', async () => {
		render(
			<Form
				form={doc(oneField, { response: { type: 'message', message: lexical('Done {{first}}') } })}
				onSubmit={vi.fn().mockResolvedValue({ ok: true })}
			/>
		)
		fireEvent.change(screen.getByLabelText('First'), { target: { value: 'Ada' } })
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

		expect(await screen.findByRole('status')).toHaveTextContent('Done Ada')
		expect(screen.queryByLabelText('First')).toBeNull()
	})
})
