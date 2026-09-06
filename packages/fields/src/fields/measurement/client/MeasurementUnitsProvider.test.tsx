// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getPreference = vi.fn()
const setPreference = vi.fn()
vi.mock('@payloadcms/ui', () => ({
	usePreferences: () => ({ getPreference, setPreference }),
}))

const { MeasurementUnitsProvider, useMeasurementUnits } = await import('./MeasurementUnitsProvider')

const Probe = () => {
	const ctx = useMeasurementUnits()
	if (!ctx) return <span>no-context</span>
	return (
		<button onClick={() => ctx.setUnit('bodyWeight', 'lb')} type="button">
			{ctx.ready ? 'ready' : 'loading'}:{ctx.units.bodyWeight ?? 'unset'}
		</button>
	)
}

describe('MeasurementUnitsProvider', () => {
	beforeEach(() => {
		getPreference.mockClear()
		setPreference.mockClear()
	})

	afterEach(() => {
		cleanup()
	})

	it('returns null without a provider', () => {
		render(<Probe />)
		expect(screen.getByText('no-context')).toBeDefined()
	})
	it('loads the stored preference and exposes it', async () => {
		getPreference.mockResolvedValueOnce({ bodyWeight: 'st-lb' })
		render(
			<MeasurementUnitsProvider>
				<Probe />
			</MeasurementUnitsProvider>
		)
		await waitFor(() => expect(screen.getByRole('button').textContent).toBe('ready:st-lb'))
	})
	it('setUnit updates state immediately and persists with merge', async () => {
		getPreference.mockResolvedValueOnce(null)
		render(
			<MeasurementUnitsProvider>
				<Probe />
			</MeasurementUnitsProvider>
		)
		await waitFor(() => expect(screen.getByRole('button').textContent).toContain('ready'))
		act(() => screen.getByRole('button').click())
		expect(screen.getByRole('button').textContent).toBe('ready:lb')
		expect(setPreference).toHaveBeenCalledWith('10x-fields-measurement', { bodyWeight: 'lb' }, true)
	})
	it('a toggle made before the fetch resolves survives it', async () => {
		let resolve: (v: unknown) => void = () => {}
		getPreference.mockReturnValueOnce(
			new Promise((r) => {
				resolve = r
			})
		)
		render(
			<MeasurementUnitsProvider>
				<Probe />
			</MeasurementUnitsProvider>
		)
		act(() => screen.getByRole('button').click())
		act(() => resolve({ bodyWeight: 'kg', personHeight: 'ft-in' }))
		await waitFor(() => expect(screen.getByRole('button').textContent).toBe('ready:lb'))
	})
	it('persist=false skips the preference fetch and is ready immediately', () => {
		render(
			<MeasurementUnitsProvider persist={false}>
				<Probe />
			</MeasurementUnitsProvider>
		)
		expect(screen.getByRole('button').textContent).toBe('ready:unset')
		expect(getPreference).not.toHaveBeenCalled()
	})
	it('persist=false keeps toggles session-only, never writing them', () => {
		render(
			<MeasurementUnitsProvider persist={false}>
				<Probe />
			</MeasurementUnitsProvider>
		)
		act(() => screen.getByRole('button').click())
		expect(screen.getByRole('button').textContent).toBe('ready:lb')
		expect(setPreference).not.toHaveBeenCalled()
	})
})
