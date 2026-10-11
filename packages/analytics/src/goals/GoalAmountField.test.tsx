import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { keys } from '../translations/keys'
import { GoalAmountField, type GoalAmountFieldProps } from './GoalAmountField'

interface FieldStateDouble {
	value?: unknown
	showError?: boolean
}

const mocks = vi.hoisted(() => ({
	fields: {} as Record<string, { value?: unknown; showError?: boolean }>,
	formInitializing: false,
	language: 'en',
	setValue: vi.fn(),
	withCondition: vi.fn((component: unknown) => component),
}))

vi.mock('@payloadcms/ui/shared', () => ({ mergeFieldStyles: () => ({}) }))

vi.mock('@payloadcms/ui', async () => {
	const { selectMocks } = await import('../testing/selectMocks')
	return {
		ChevronIcon: selectMocks.ChevronIcon,
		FieldDescription: ({ description }: { description?: string }) => (
			<span data-testid="description">{description ?? ''}</span>
		),
		FieldError: ({ path, showError }: { path: string; showError?: boolean }) =>
			showError ? <span data-testid={`error-${path}`} /> : null,
		FieldLabel: ({ label }: { label?: string }) => <span data-testid="label">{label ?? ''}</span>,
		fieldBaseClass: 'field-type',
		ReactSelect: selectMocks.ReactSelect,
		RenderCustomComponent: ({
			CustomComponent,
			Fallback,
		}: {
			CustomComponent?: ReactNode
			Fallback?: ReactNode
		}) => <>{CustomComponent ?? Fallback}</>,
		useField: ({
			path,
			potentiallyStalePath,
		}: {
			path?: string
			potentiallyStalePath?: string
		}) => {
			const resolved = path ?? potentiallyStalePath ?? ''
			const state = mocks.fields[resolved] ?? {}
			return {
				customComponents: {},
				disabled: false,
				formInitializing: mocks.formInitializing,
				path: resolved,
				setValue: (value: unknown, disableModifyingForm?: boolean) =>
					mocks.setValue(resolved, value, disableModifyingForm),
				showError: state.showError ?? false,
				value: state.value,
			}
		},
		useTranslation: () => ({ i18n: { language: mocks.language }, t: (key: string) => key }),
		withCondition: mocks.withCondition,
	}
})

const props = (overrides: Partial<GoalAmountFieldProps> = {}): GoalAmountFieldProps =>
	({
		field: {
			name: 'fixed',
			type: 'number',
			label: 'Amount',
			min: 0,
			admin: { description: 'Worth' },
		},
		path: 'value.fixed',
		readOnly: false,
		currencyPath: '../currency',
		...overrides,
	}) as unknown as GoalAmountFieldProps

const withFields = (fields: Record<string, FieldStateDouble>) => {
	mocks.fields = fields
}

const amountInput = () => screen.getByRole('spinbutton') as HTMLInputElement
const currencySelect = () =>
	screen.getByRole('combobox', { name: keys.goalFieldCurrency }) as HTMLSelectElement
const optionLabels = () => Array.from(currencySelect().options).map((option) => option.textContent)

beforeEach(() => {
	mocks.fields = {}
	mocks.formInitializing = false
	mocks.language = 'en'
	mocks.setValue.mockClear()
})

afterEach(() => {
	cleanup()
})

describe('GoalAmountField', () => {
	it('is wrapped in withCondition so admin.condition hides it', () => {
		expect(mocks.withCondition).toHaveBeenCalled()
	})

	it('shows the amount and the stored currency side by side, under one label', () => {
		withFields({ 'value.fixed': { value: 12.5 }, currency: { value: 'USD' } })
		render(<GoalAmountField {...props()} />)
		expect(screen.getByTestId('label').textContent).toBe('Amount')
		expect(amountInput().value).toBe('12.5')
		expect(amountInput().id).toBe('field-value__fixed')
		expect(currencySelect().value).toBe('USD')
		expect(screen.getByTestId('description').textContent).toBe('Worth')
	})

	it('writes the amount to its own path and the currency to the field beside its group', () => {
		withFields({ 'value.fixed': { value: 12 }, currency: { value: 'USD' } })
		render(<GoalAmountField {...props()} />)
		fireEvent.change(amountInput(), { target: { value: '25.5' } })
		expect(mocks.setValue).toHaveBeenCalledWith('value.fixed', 25.5, undefined)
		fireEvent.change(amountInput(), { target: { value: '' } })
		expect(mocks.setValue).toHaveBeenCalledWith('value.fixed', null, undefined)
		fireEvent.change(currencySelect(), { target: { value: 'EUR' } })
		expect(mocks.setValue).toHaveBeenCalledWith('currency', 'EUR', undefined)
	})

	it('reads a sibling currency inside an action block', () => {
		withFields({ 'actions.2.value': { value: 40 }, 'actions.2.currency': { value: 'GBP' } })
		render(<GoalAmountField {...props({ path: 'actions.2.value', currencyPath: 'currency' })} />)
		expect(currencySelect().value).toBe('GBP')
		fireEvent.change(currencySelect(), { target: { value: 'EUR' } })
		expect(mocks.setValue).toHaveBeenCalledWith('actions.2.currency', 'EUR', undefined)
	})

	it('names the currencies in the admin language', () => {
		withFields({ currency: { value: 'USD' } })
		mocks.language = 'de'
		render(<GoalAmountField {...props()} />)
		expect(optionLabels()).toContain('US-Dollar (USD)')
		expect(optionLabels()).toContain('Euro (EUR)')
		cleanup()
		mocks.language = 'en'
		render(<GoalAmountField {...props()} />)
		expect(optionLabels()).toContain('US Dollar (USD)')
	})

	it('keeps a stored code the list lacks as the picked option', () => {
		withFields({ 'value.fixed': { value: 5 }, currency: { value: 'XOF' } })
		render(<GoalAmountField {...props()} />)
		expect(currencySelect().value).toBe('XOF')
		expect(optionLabels()).toContain('West African CFA Franc (XOF)')
		cleanup()
		withFields({ 'value.fixed': { value: 5 }, currency: { value: 'euro' } })
		render(<GoalAmountField {...props()} />)
		expect(currencySelect().value).toBe('euro')
	})

	it('shows the default currency while none is stored, and writes nothing without an amount', () => {
		render(<GoalAmountField {...props({ defaultCurrency: 'EUR' })} />)
		expect(currencySelect().value).toBe('EUR')
		expect(mocks.setValue).not.toHaveBeenCalled()
	})

	it('fills in the default once an amount is set, without marking the goal changed', () => {
		withFields({ 'value.fixed': { value: 10 } })
		render(<GoalAmountField {...props({ defaultCurrency: 'EUR' })} />)
		expect(mocks.setValue).toHaveBeenCalledWith('currency', 'EUR', true)
	})

	it('leaves a stored currency, a read-only form and a loading form alone', () => {
		withFields({ 'value.fixed': { value: 10 }, currency: { value: 'USD' } })
		render(<GoalAmountField {...props({ defaultCurrency: 'EUR' })} />)
		cleanup()
		withFields({ 'value.fixed': { value: 10 } })
		render(<GoalAmountField {...props({ defaultCurrency: 'EUR', readOnly: true })} />)
		expect(amountInput().disabled).toBe(true)
		expect(currencySelect().disabled).toBe(true)
		cleanup()
		mocks.formInitializing = true
		render(<GoalAmountField {...props({ defaultCurrency: 'EUR' })} />)
		expect(mocks.setValue).not.toHaveBeenCalled()
	})

	it('leaves the currency empty for the editor to pick when there is no default', () => {
		withFields({ 'value.fixed': { value: 10 } })
		render(<GoalAmountField {...props()} />)
		expect(currencySelect().value).toBe('')
		expect(mocks.setValue).not.toHaveBeenCalled()
	})

	it('shows the currency error beside the select', () => {
		withFields({ 'value.fixed': { value: 10 }, currency: { showError: true } })
		render(<GoalAmountField {...props()} />)
		expect(screen.getByTestId('error-currency')).toBeDefined()
		expect(screen.queryByTestId('error-value.fixed')).toBeNull()
	})
})
