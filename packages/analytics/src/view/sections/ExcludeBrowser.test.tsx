import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { a11yViolations } from '../../testing/a11y'
import { keys } from '../../translations/keys'
import type { ExclusionSite } from '../exclusionLink'
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
		el?: 'anchor'
		url?: string
		newTab?: boolean
		extraButtonProps?: Record<string, unknown>
	}) =>
		el === 'anchor' ? (
			<a
				className="btn"
				href={url}
				rel={newTab ? 'noopener noreferrer' : undefined}
				target={newTab ? '_blank' : undefined}
				{...extraButtonProps}
			>
				{children}
			</a>
		) : (
			<button disabled={disabled} onClick={onClick} type="button" {...extraButtonProps}>
				{children}
			</button>
		),
	useTranslation: () => ({
		i18n: { language: 'en' },
		t: (key: string) => key,
	}),
}))

const answer = (body: unknown, ok = true): Response =>
	({ ok, json: () => Promise.resolve(body) }) as Response

const TOKEN = 'abc_DEF-123'
const ALPHA = 'https://alpha.example.com'

const site = (address: string, token = TOKEN): ExclusionSite => ({ address, token })

const linkFor = (sameOrigin: boolean | null, sites: ExclusionSite[] = []) => ({
	param: 'analytics_exclude',
	token: TOKEN,
	sameOrigin,
	sites,
})

const mount = async (body: unknown, ok = true) => {
	const fetchMock = vi.fn(() => Promise.resolve(answer(body, ok)))
	vi.stubGlobal('fetch', fetchMock)
	let view: ReturnType<typeof render> | undefined
	await act(async () => {
		view = render(<ExcludeBrowser endpoint="/api/_x/exclusion" />)
	})
	if (!view) {
		throw new Error('not rendered')
	}
	return { fetchMock, ...view }
}

const button = (name: string) => screen.getByRole('button', { name })
const links = (name: string) => screen.getAllByRole('link', { name })
const describedBy = (element: HTMLElement): string =>
	document.getElementById(element.getAttribute('aria-describedby') ?? '')?.textContent ?? ''

const nth = (list: HTMLElement[], index: number): HTMLElement => {
	const element = list[index]
	if (!element) {
		throw new Error(`no element ${index}`)
	}
	return element
}

const opensInNewTab = (element: HTMLElement) => {
	expect(element.tagName).toBe('A')
	expect(element.getAttribute('target')).toBe('_blank')
	expect(element.getAttribute('rel')).toBe('noopener noreferrer')
}

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
})

describe('ExcludeBrowser', () => {
	it("hands out the part to add to the site's address, and the part that undoes it, where no site is known", async () => {
		for (const sameOrigin of [false, null]) {
			const { fetchMock } = await mount(linkFor(sameOrigin))
			expect(fetchMock).toHaveBeenCalledWith(
				'/api/_x/exclusion',
				expect.objectContaining({ credentials: 'same-origin' })
			)
			const field: HTMLInputElement = screen.getByLabelText(keys.viewExclusionLinkLabel)
			expect(field.value).toBe(`?analytics_exclude=${TOKEN}`)
			expect(screen.getByText(keys.viewExclusionQueryHelp)).toBeDefined()
			const undo: HTMLInputElement = screen.getByLabelText(keys.viewExclusionUndoLabel)
			expect(undo.value).toBe('?analytics_exclude=0')
			expect(screen.getAllByRole('button', { name: keys.viewExclusionCopy })).toHaveLength(2)
			expect(screen.queryByRole('link')).toBeNull()
			cleanup()
		}
	})

	it("takes the admin's own address as the site when the server knows the site runs there", async () => {
		await mount(linkFor(true))
		const stop = links(keys.viewExclusionExclude)
		expect(stop).toHaveLength(1)
		expect(stop[0]?.getAttribute('href')).toBe(
			`${window.location.origin}/?analytics_exclude=${TOKEN}`
		)
		expect(screen.queryByRole('textbox')).toBeNull()
	})

	it("gives each named site a row with its own token's link and its =0 link, both in a new tab", async () => {
		await mount(linkFor(false, [site(`${ALPHA}/`), site('https://shop.example.com/de', 'other')]))
		const stop = links(keys.viewExclusionExclude)
		const resume = links(keys.viewExclusionInclude)
		expect(stop.map((link) => link.getAttribute('href'))).toEqual([
			`${ALPHA}/?analytics_exclude=${TOKEN}`,
			'https://shop.example.com/de?analytics_exclude=other',
		])
		expect(resume.map((link) => link.getAttribute('href'))).toEqual([
			`${ALPHA}/?analytics_exclude=0`,
			'https://shop.example.com/de?analytics_exclude=0',
		])
		for (const link of [...stop, ...resume]) {
			opensInNewTab(link)
		}
		expect(describedBy(nth(stop, 1))).toBe('shop.example.com/de')
		expect(describedBy(nth(resume, 0))).toBe('alpha.example.com')
		expect(screen.getByText(keys.viewExclusionSitesHelp)).toBeDefined()
		expect(screen.queryByRole('textbox')).toBeNull()
	})

	it("copies a site's signed link for another browser and says so", async () => {
		const writeText = vi.fn(() => Promise.resolve())
		vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
		await mount(linkFor(false, [site(`${ALPHA}/`)]))
		const share = button(keys.viewExclusionShare)
		expect(describedBy(share)).toBe('alpha.example.com')
		await act(async () => {
			fireEvent.click(share)
		})
		expect(writeText).toHaveBeenCalledWith(`${ALPHA}/?analytics_exclude=${TOKEN}`)
		expect(button('general:copied')).toBeDefined()
	})

	it('copies the part to add, and the part that undoes it', async () => {
		const writeText = vi.fn(() => Promise.resolve())
		vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
		await mount(linkFor(false))
		const copies = screen.getAllByRole('button', { name: keys.viewExclusionCopy })
		expect(describedBy(nth(copies, 1))).toBe(keys.viewExclusionUndoLabel)
		await act(async () => {
			fireEvent.click(nth(copies, 0))
			fireEvent.click(nth(copies, 1))
		})
		expect(writeText.mock.calls).toEqual([
			[`?analytics_exclude=${TOKEN}`],
			['?analytics_exclude=0'],
		])
	})

	// A link reads left to right on a right-to-left page too.
	it('keeps every link field and site name left to right', async () => {
		await mount(linkFor(false))
		for (const field of screen.getAllByRole('textbox')) {
			expect(field.getAttribute('dir')).toBe('ltr')
		}
		cleanup()
		await mount(linkFor(false, [site(`${ALPHA}/`)]))
		expect(screen.getByText('alpha.example.com').getAttribute('dir')).toBe('ltr')
	})

	it('titles itself with a heading and has no structural violations in either layout', async () => {
		for (const body of [linkFor(null), linkFor(null, [site(`${ALPHA}/`)])]) {
			const { container } = await mount(body)
			expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(keys.viewExclusionTitle)
			expect(screen.getByRole('region', { name: keys.viewExclusionTitle })).toBeDefined()
			expect(a11yViolations(container)).toEqual([])
			cleanup()
		}
	})

	it('says so when the link cannot be loaded, and lets the reader ask again', async () => {
		const { fetchMock } = await mount({ error: { code: 'forbidden' } }, false)
		expect(screen.getByRole('alert').textContent).toBe(keys.viewExclusionFailed)
		await act(async () => {
			fireEvent.click(button(keys.viewRetry))
		})
		expect(fetchMock).toHaveBeenCalledTimes(2)
	})
})
