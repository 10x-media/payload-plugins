import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FormFieldInstance } from '../submissions/types'
import { en } from '../translations/en'
import { keys } from '../translations/keys'
import { makeTranslate } from '../translations/makeTranslate'
import type { RendererTranslate } from './contract'
import { Form, type FormDocument } from './Form'

afterEach(() => {
	cleanup()
})

const doc = (fields: FormFieldInstance[], id: number | string = 1): FormDocument => ({
	id,
	fields,
	multistep: false,
	pollEnabled: false,
})

/** A `t` that overrides a few keys and falls back to the bundled English for the rest. */
const withOverrides = (overrides: Record<string, string>): RendererTranslate => {
	const base = makeTranslate(en)
	return (key) => overrides[key] ?? base(key)
}

const oneField: FormFieldInstance[] = [{ blockType: 'text', name: 'name', label: 'Name' }]

describe('Form default copy localization', () => {
	it('localizes the success message through t when no successMessage prop is given', async () => {
		const t = withOverrides({ [keys.formSuccess]: 'Vielen Dank!' })
		render(<Form form={doc(oneField)} onSubmit={vi.fn().mockResolvedValue({ ok: true })} t={t} />)

		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

		expect(await screen.findByRole('status')).toHaveTextContent('Vielen Dank!')
	})

	it('localizes the submit-failure fallback through t when the result carries no message', async () => {
		const t = withOverrides({ [keys.formSubmitFailed]: 'Übermittlung fehlgeschlagen' })
		const onError = vi.fn()
		render(
			<Form
				form={doc(oneField)}
				onSubmit={vi.fn().mockResolvedValue({ ok: false })}
				onError={onError}
				t={t}
			/>
		)

		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

		await waitFor(() => expect(onError).toHaveBeenCalledWith('Übermittlung fehlgeschlagen'))
		expect(screen.getByRole('alert')).toHaveTextContent('Übermittlung fehlgeschlagen')
	})

	it('localizes the overlay close control through t when no closeLabel prop is given', () => {
		const t = withOverrides({ [keys.formClose]: 'Schließen' })
		render(
			<Form
				form={doc(oneField)}
				presentation="modal"
				onSubmit={vi.fn().mockResolvedValue({ ok: true })}
				t={t}
			/>
		)

		expect(screen.getByRole('button', { name: 'Schließen' })).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
	})
})
