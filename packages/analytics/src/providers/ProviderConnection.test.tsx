import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { keys } from '../translations/keys'
import type { ProviderStatusResponse } from './connectionState'
import { ProviderConnection } from './ProviderConnection'

const doc = vi.hoisted(() => ({
	id: '6650f1c2a9e4b3d2c1a09f87' as string | undefined,
	modified: false,
	hasSavePermission: true,
	lastUpdateTime: 1,
	provider: 'plausible',
}))
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock('@payloadcms/ui', () => ({
	Banner: ({ children, type }: { children?: ReactNode; type?: string }) => (
		<div data-banner={type}>{children}</div>
	),
	Button: ({
		children,
		disabled,
		onClick,
	}: {
		children?: ReactNode
		disabled?: boolean
		onClick?: () => void
	}) => (
		<button disabled={disabled} onClick={onClick} type="button">
			{children}
		</button>
	),
	FieldDescription: ({ description }: { description?: string }) => <p>{description}</p>,
	FieldLabel: ({ label }: { label?: string }) => <span>{label}</span>,
	fieldBaseClass: 'field-type',
	ShimmerEffect: () => <span data-testid="shimmer" />,
	toast: toasts,
	useConfig: () => ({
		config: { admin: { dateFormat: 'yyyy-MM-dd HH:mm' }, routes: { admin: '/admin', api: '/api' } },
	}),
	useDocumentInfo: () => ({
		id: doc.id,
		hasSavePermission: doc.hasSavePermission,
		lastUpdateTime: doc.lastUpdateTime,
	}),
	useFormFields: <T,>(select: (context: [Record<string, { value: unknown }>]) => T): T =>
		select([{ provider: { value: doc.provider } }]),
	useFormModified: () => doc.modified,
	useTranslation: () => ({
		i18n: { language: 'en', dateFNS: undefined },
		t: (key: string, vars?: Record<string, string>) =>
			vars ? `${key} ${Object.values(vars).join(' ')}` : key,
	}),
}))

vi.mock('@payloadcms/ui/shared', () => ({
	formatDate: ({ date }: { date: string }) => `<${date}>`,
}))

const fetchMock = vi.fn<typeof fetch>()

const answers = (...bodies: ProviderStatusResponse[]): void => {
	for (const body of bodies) {
		fetchMock.mockImplementationOnce(() => Promise.resolve(Response.json(body)))
	}
}

const renderPanel = async () => {
	const result = render(
		<ProviderConnection field={{ name: 'connection', type: 'ui' } as never} path="connection" />
	)
	await act(async () => {})
	return result
}

/** The value after the panel's "Status:" label. */
const statusOf = () =>
	document.querySelector(
		'.analytics-provider-connection__facts li .analytics-provider-connection__fact-value'
	)?.textContent

const testButton = () => screen.getByRole('button', { name: keys.providerConnectionTest })

beforeEach(() => {
	doc.id = '6650f1c2a9e4b3d2c1a09f87'
	doc.modified = false
	doc.hasSavePermission = true
	doc.lastUpdateTime = 1
	doc.provider = 'plausible'
	fetchMock.mockReset()
	toasts.success.mockReset()
	toasts.error.mockReset()
	vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
})

describe('ProviderConnection', () => {
	it('reads the saved document’s status and says it was never checked', async () => {
		answers({ status: {} })
		await renderPanel()
		expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
			'/api/_x/provider-status?id=6650f1c2a9e4b3d2c1a09f87'
		)
		expect(statusOf()).toBe(keys.providerConnectionUnchecked)
		expect((testButton() as HTMLButtonElement).disabled).toBe(false)
	})

	it('checks on a click and shows what the vendor said', async () => {
		answers(
			{ status: {} },
			{
				status: {
					lastErrorAt: '2026-11-09T10:00:00.000Z',
					errorKind: 'source_misconfigured',
					errorDetail: 'posthog: HTTP 403 Invalid personal API key.',
					pausedUntil: '2999-01-01T00:00:00.000Z',
				},
				checked: { ok: false, kind: 'source_misconfigured' },
			}
		)
		await renderPanel()
		await act(async () => {
			fireEvent.click(testButton())
		})
		expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('POST')
		expect(statusOf()).toBe(keys.providerConnectionNotConnected)
		const banner = screen.getByText(keys.providerConnectionRefusedHelp).closest('[data-banner]')
		expect(banner?.getAttribute('data-banner')).toBe('error')
		// The vendor's words as a reader reads them: its name, the message, then the status.
		expect(banner?.textContent).toContain(`${keys.providerNamePosthog}: Invalid personal API key.`)
		const facts = [...document.querySelectorAll('.analytics-provider-connection__facts li')].map(
			(li) => li.textContent
		)
		expect(facts).toEqual([
			`${keys.providerConnectionStatus}:\u00a0${keys.providerConnectionNotConnected}`,
			`${keys.providerConnectionLastError}:\u00a0<2026-11-09T10:00:00.000Z>`,
			`${keys.providerConnectionResumes}:\u00a0<2999-01-01T00:00:00.000Z>`,
		])
		expect(toasts.error).toHaveBeenCalledWith(keys.providerConnectionFailed)
	})

	it('shows a working connection after a failure that came before it', async () => {
		answers({
			status: {
				lastSuccessAt: '2026-11-09T10:05:00.000Z',
				lastErrorAt: '2026-11-09T10:00:00.000Z',
				errorKind: 'unavailable',
				errorDetail: 'old outage',
			},
		})
		await renderPanel()
		expect(statusOf()).toBe(keys.providerConnectionConnected)
		expect(screen.queryByText('old outage')).toBeNull()
		expect(screen.queryByText(keys.providerConnectionLastError, { exact: false })).toBeNull()
	})

	it('names the Region among what to check on a refused PostHog document', async () => {
		doc.provider = 'posthog'
		answers({
			status: { lastErrorAt: '2026-11-09T10:00:00.000Z', errorKind: 'source_misconfigured' },
		})
		await renderPanel()
		expect(screen.getByText(keys.providerConnectionRefusedHelpPosthog)).toBeDefined()
		expect(screen.queryByText(keys.providerConnectionRefusedHelp)).toBeNull()
	})

	it('says an outage is unreachable rather than refused', async () => {
		answers({ status: { lastErrorAt: '2026-11-09T10:00:00.000Z', errorKind: 'unavailable' } })
		await renderPanel()
		expect(statusOf()).toBe(keys.providerConnectionNoAnswer)
		expect(
			screen
				.getByText(keys.providerConnectionUnreachableHelp)
				.closest('[data-banner]')
				?.getAttribute('data-banner')
		).toBe('default')
	})

	it('toasts a working check', async () => {
		answers(
			{ status: {} },
			{ status: { lastSuccessAt: '2026-11-09T10:00:00.000Z' }, checked: { ok: true } }
		)
		await renderPanel()
		await act(async () => {
			fireEvent.click(testButton())
		})
		expect(toasts.success).toHaveBeenCalledWith(keys.providerConnectionChecked)
		expect(screen.getByText(keys.providerConnectionConnected)).toBeDefined()
	})

	it('asks for a save first on a new document, and reads nothing', async () => {
		doc.id = undefined
		await renderPanel()
		expect(fetchMock).not.toHaveBeenCalled()
		expect((testButton() as HTMLButtonElement).disabled).toBe(true)
		expect(screen.getByText(keys.providerConnectionSaveFirst)).toBeDefined()
	})

	it('asks for a save first while the form has unsaved changes', async () => {
		doc.modified = true
		answers({ status: {} })
		await renderPanel()
		expect((testButton() as HTMLButtonElement).disabled).toBe(true)
		expect(screen.getByText(keys.providerConnectionUnsaved)).toBeDefined()
	})

	it('says why a reader who may not edit the document cannot test it', async () => {
		doc.hasSavePermission = false
		answers({ status: {} })
		await renderPanel()
		expect((testButton() as HTMLButtonElement).disabled).toBe(true)
		expect(screen.getByText(keys.providerConnectionNoPermission)).toBeDefined()
	})

	it('reads the status again after a save, which may have reset it', async () => {
		answers(
			{ status: { lastErrorAt: '2026-11-08T10:00:00.000Z', errorKind: 'source_misconfigured' } },
			{ status: {} }
		)
		const panel = await renderPanel()
		expect(statusOf()).toBe(keys.providerConnectionNotConnected)
		doc.lastUpdateTime = 2
		panel.rerender(
			<ProviderConnection field={{ name: 'connection', type: 'ui' } as never} path="connection" />
		)
		await act(async () => {})
		expect(fetchMock).toHaveBeenCalledTimes(2)
		expect(statusOf()).toBe(keys.providerConnectionUnchecked)
	})

	it('toasts a check the endpoint refused, and keeps the status it had', async () => {
		answers({ status: {} })
		fetchMock.mockImplementationOnce(() =>
			Promise.resolve(
				Response.json({ error: { code: 'forbidden', message: 'no' } }, { status: 403 })
			)
		)
		await renderPanel()
		await act(async () => {
			fireEvent.click(testButton())
		})
		expect(toasts.error).toHaveBeenCalledWith(keys.providerConnectionFailed)
		expect(screen.getByText(keys.providerConnectionUnchecked)).toBeDefined()
	})
})
