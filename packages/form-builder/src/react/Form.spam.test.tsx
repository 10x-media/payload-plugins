import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FormFieldInstance } from '../submissions/types'
import { Form, type FormDocument } from './Form'

afterEach(() => {
	cleanup()
})

const doc = (id: number | string = 1): FormDocument => ({
	id,
	fields: [{ blockType: 'text', name: 'name', label: 'Name' }] as FormFieldInstance[],
	multistep: false,
	pollEnabled: false,
})

const submittedValues = (
	onSubmit: ReturnType<typeof vi.fn>
): Array<{ field: string; value: unknown }> =>
	(onSubmit.mock.calls[0]?.[0] as { values: Array<{ field: string; value: unknown }> }).values

describe('Form spam wiring', () => {
	it('submits the filled decoy under a reserved key while keeping the cosmetic DOM name', async () => {
		const onSubmit = vi.fn().mockResolvedValue({ ok: true })
		const { container } = render(<Form form={doc()} onSubmit={onSubmit} />)
		const decoy = container.querySelector('input[name="website"]') as HTMLInputElement | null
		expect(decoy).not.toBeNull()
		fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Jo' } })
		fireEvent.change(decoy as HTMLInputElement, { target: { value: 'bot' } })
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
		await waitFor(() => expect(onSubmit).toHaveBeenCalled())
		expect(submittedValues(onSubmit)).toContainEqual({ field: '__fb_hp', value: 'bot' })
		expect(submittedValues(onSubmit).map((v) => v.field)).not.toContain('website')
	})

	it('does not append the decoy when it is left empty (a real user)', async () => {
		const onSubmit = vi.fn().mockResolvedValue({ ok: true })
		render(<Form form={doc()} onSubmit={onSubmit} />)
		fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Jo' } })
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
		await waitFor(() => expect(onSubmit).toHaveBeenCalled())
		expect(submittedValues(onSubmit).map((v) => v.field)).toEqual(['name'])
	})

	it('appends a captcha token when provided', async () => {
		const onSubmit = vi.fn().mockResolvedValue({ ok: true })
		render(<Form form={doc()} onSubmit={onSubmit} captchaToken="tok" />)
		fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Jo' } })
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
		await waitFor(() => expect(onSubmit).toHaveBeenCalled())
		expect(submittedValues(onSubmit)).toContainEqual({ field: '__fb_captcha', value: 'tok' })
	})

	it('appends a signed context token under a reserved key when provided', async () => {
		const onSubmit = vi.fn().mockResolvedValue({ ok: true })
		render(<Form form={doc()} onSubmit={onSubmit} context="v1.body.sig" />)
		fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Jo' } })
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
		await waitFor(() => expect(onSubmit).toHaveBeenCalled())
		expect(submittedValues(onSubmit)).toContainEqual({ field: '__fb_ctx', value: 'v1.body.sig' })
	})

	it('appends no context entry when the form has none', async () => {
		const onSubmit = vi.fn().mockResolvedValue({ ok: true })
		render(<Form form={doc()} onSubmit={onSubmit} />)
		fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Jo' } })
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
		await waitFor(() => expect(onSubmit).toHaveBeenCalled())
		expect(submittedValues(onSubmit).map((v) => v.field)).not.toContain('__fb_ctx')
	})

	it('renders no decoy when honeypot is false', async () => {
		const onSubmit = vi.fn().mockResolvedValue({ ok: true })
		const { container } = render(<Form form={doc()} onSubmit={onSubmit} honeypot={false} />)
		expect(container.querySelector('input[name="website"]')).toBeNull()
		fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Jo' } })
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
		await waitFor(() => expect(onSubmit).toHaveBeenCalled())
		expect(submittedValues(onSubmit).map((v) => v.field)).toEqual(['name'])
	})
})
