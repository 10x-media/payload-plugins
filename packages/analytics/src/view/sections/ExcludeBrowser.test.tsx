import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { a11yViolations } from '../../testing/a11y'
import { EXCLUSION_STORAGE_KEY } from '../../tracker/exclusion'
import { keys } from '../../translations/keys'
import { ExcludeBrowser } from './ExcludeBrowser'

vi.mock('@payloadcms/ui', () => ({
	Banner: ({ children }: { children?: ReactNode }) => <div role="alert">{children}</div>,
	Button: ({
		children,
		onClick,
		disabled,
		el,
		url,
		newTab,
		extraButtonProps,
	}: {
		children?: ReactNode
		onClick?: () => void
		disabled?: boolean
		el?: string
		url?: string
		newTab?: boolean
		extraButtonProps?: Record<string, unknown>
	}) =>
		el === 'anchor' ? (
			<a href={url} {...(newTab ? { target: '_blank' } : {})} {...extraButtonProps}>
				{children}
			</a>
		) : (
			<button disabled={disabled} onClick={onClick} type="button" {...extraButtonProps}>
				{children}
			</button>
		),
	CheckboxInput: ({
		checked,
		label,
		onToggle,
	}: {
		checked?: boolean
		label?: string
		onToggle: () => void
	}) => (
		<label>
			<input checked={checked === true} onChange={onToggle} type="checkbox" />
			{label}
		</label>
	),
	useTranslation: () => ({
		i18n: { language: 'en' },
		t: (key: string, vars?: Record<string, string>) =>
			vars ? `${key} ${JSON.stringify(vars)}` : key,
	}),
}))

const answer = (body: unknown, ok = true): Response =>
	({ ok, json: () => Promise.resolve(body) }) as Response

const TOKEN = 'abc_DEF-123'

const linkFor = (sameOrigin: boolean | null, sites: string[] = []) => ({
	param: 'analytics_exclude',
	token: TOKEN,
	sameOrigin,
	sites,
})

const open = async (body: unknown, ok = true) => {
	const fetchMock = vi.fn(() => Promise.resolve(answer(body, ok)))
	vi.stubGlobal('fetch', fetchMock)
	const view = render(<ExcludeBrowser endpoint="/api/_x/exclusion" />)
	expect(fetchMock).not.toHaveBeenCalled()
	await act(async () => {
		fireEvent.click(screen.getByText(keys.viewExclusionShow))
	})
	return { fetchMock, ...view }
}

const linkField = (): HTMLInputElement => screen.getByLabelText(keys.viewExclusionLinkLabel)

beforeEach(() => {
	window.localStorage.clear()
})

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
})

describe('ExcludeBrowser', () => {
	it("asks for the link only when the reader wants it, then shows the part to add to the site's address", async () => {
		const { fetchMock } = await open(linkFor(null))
		expect(fetchMock).toHaveBeenCalledWith(
			'/api/_x/exclusion',
			expect.objectContaining({ credentials: 'same-origin' })
		)
		expect(linkField().value).toBe(`?analytics_exclude=${TOKEN}`)
		expect(screen.getByText(keys.viewExclusionQueryHelp)).toBeDefined()
	})

	it('hands out the same part whatever the origin, never the admin address', async () => {
		for (const sameOrigin of [true, false, null]) {
			await open(linkFor(sameOrigin))
			expect(linkField().value).toBe(`?analytics_exclude=${TOKEN}`)
			expect(linkField().value).not.toContain(window.location.origin)
			cleanup()
		}
	})

	it('hands out a whole link per site the install names, to copy or to open', async () => {
		await open(linkFor(false, ['https://alpha.example.com/', 'https://shop.example.com/de']))
		const first = screen.getByLabelText(
			`${keys.viewExclusionLinkFor} ${JSON.stringify({ site: 'alpha.example.com' })}`
		)
		const second = screen.getByLabelText(
			`${keys.viewExclusionLinkFor} ${JSON.stringify({ site: 'shop.example.com/de' })}`
		)
		expect((first as HTMLInputElement).value).toBe(
			`https://alpha.example.com/?analytics_exclude=${TOKEN}`
		)
		expect((second as HTMLInputElement).value).toBe(
			`https://shop.example.com/de?analytics_exclude=${TOKEN}`
		)
		const opens = screen.getAllByRole('link', { name: keys.viewExclusionOpen })
		expect(opens.map((link) => link.getAttribute('href'))).toEqual([
			`https://alpha.example.com/?analytics_exclude=${TOKEN}`,
			`https://shop.example.com/de?analytics_exclude=${TOKEN}`,
		])
		expect(opens[0]?.getAttribute('target')).toBe('_blank')
		// Each button says which link it acts on, through the label of that link.
		const copies = screen.getAllByRole('button', { name: 'general:copy' })
		expect(copies).toHaveLength(2)
		expect(
			document.getElementById(copies[1]?.getAttribute('aria-describedby') ?? '')?.textContent
		).toBe(`${keys.viewExclusionLinkFor} ${JSON.stringify({ site: 'shop.example.com/de' })}`)
		expect(screen.getByText(keys.viewExclusionSitesHelp)).toBeDefined()
		expect(screen.queryByText(keys.viewExclusionQueryHelp)).toBeNull()
	})

	it('copies a link and says so, in a button named by its text', async () => {
		const writeText = vi.fn(() => Promise.resolve())
		vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
		await open(linkFor(false, ['https://alpha.example.com/']))
		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: 'general:copy' }))
		})
		expect(writeText).toHaveBeenCalledWith(`https://alpha.example.com/?analytics_exclude=${TOKEN}`)
		expect(screen.getByRole('button', { name: 'general:copied' })).toBeDefined()
	})

	// A link reads left to right on a right-to-left page too.
	it('keeps every link field left to right', async () => {
		await open(linkFor(false, ['https://alpha.example.com/']))
		for (const field of screen.getAllByRole('textbox')) {
			expect(field.getAttribute('dir')).toBe('ltr')
		}
	})

	it('moves focus to the first link once it replaces the button that asked for it', async () => {
		await open(linkFor(false, ['https://alpha.example.com/', 'https://shop.example.com/']))
		expect(document.activeElement).toBe(screen.getAllByRole('textbox')[0])
	})

	it('titles itself with a heading and has no structural violations', async () => {
		const { container } = await open(linkFor(null, ['https://alpha.example.com/']))
		expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(keys.viewExclusionTitle)
		expect(screen.getByRole('region', { name: keys.viewExclusionTitle })).toBeDefined()
		expect(a11yViolations(container)).toEqual([])
	})

	it('offers the switch plainly where the admin is confirmed as the site', async () => {
		await open(linkFor(true))
		expect(screen.getByRole('checkbox')).toBeDefined()
		expect(screen.queryByText(keys.viewExclusionToggleCaveat)).toBeNull()
	})

	it('says the switch only works at this address where the install cannot tell', async () => {
		await open(linkFor(null))
		expect(screen.getByRole('checkbox')).toBeDefined()
		expect(screen.getByText(keys.viewExclusionToggleCaveat)).toBeDefined()
	})

	it('hides the switch where the admin runs elsewhere than the site', async () => {
		await open(linkFor(false))
		expect(screen.queryByText(keys.viewExclusionToggle)).toBeNull()
		expect(screen.queryByRole('checkbox')).toBeNull()
	})

	it('sets and clears the flag in this browser from the switch', async () => {
		await open(linkFor(true))
		const toggle = screen.getByRole('checkbox')
		expect((toggle as HTMLInputElement).checked).toBe(false)

		await act(async () => {
			fireEvent.click(toggle)
		})
		expect(window.localStorage.getItem(EXCLUSION_STORAGE_KEY)).toBe('1')
		expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)

		await act(async () => {
			fireEvent.click(screen.getByRole('checkbox'))
		})
		expect(window.localStorage.getItem(EXCLUSION_STORAGE_KEY)).toBeNull()
	})

	it('says so when the link cannot be loaded, and lets the reader ask again', async () => {
		await open({ error: { code: 'forbidden' } }, false)
		expect(screen.getByRole('alert').textContent).toBe(keys.viewExclusionFailed)
		expect(screen.getByText(keys.viewExclusionShow)).toBeDefined()
	})
})
