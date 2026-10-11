import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { keys } from '../../translations/keys'
import { failureOf, QueryFetchError } from '../../ui/data/request'
import { NoSources, SectionError } from './EmptyStates'

const admin = vi.hoisted(() => ({ language: 'en' }))

vi.mock('@payloadcms/ui', () => ({
	Banner: ({ children }: { children?: ReactNode }) => <div role="alert">{children}</div>,
	Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
		// biome-ignore lint/a11y/useButtonType: test double
		<button onClick={onClick}>{children}</button>
	),
	useTranslation: () => ({
		i18n: { language: admin.language },
		t: (key: string, vars?: Record<string, string>) =>
			vars ? `${key} ${JSON.stringify(vars)}` : key,
	}),
}))

afterEach(() => {
	cleanup()
	admin.language = 'en'
})

const retryIn = (duration: string): string =>
	`${keys.viewErrorRetryAfter} ${JSON.stringify({ duration })}`

describe('SectionError', () => {
	it('explains a busy provider, names the retry delay, and offers a retry', () => {
		const onRetry = vi.fn()
		render(
			<SectionError
				error={failureOf(new QueryFetchError(503, { code: 'unavailable', message: 'busy' }, 30))}
				onRetry={onRetry}
			/>
		)
		expect(screen.getByText(keys.viewErrorBusy)).toBeDefined()
		expect(screen.getByText(retryIn('30s'))).toBeDefined()
		fireEvent.click(screen.getByText(keys.viewRetry))
		expect(onRetry).toHaveBeenCalled()
	})

	it('offers no retry for a denied read', () => {
		render(<SectionError error={{ code: 'forbidden' }} onRetry={() => {}} />)
		expect(screen.getByText(keys.viewErrorForbidden)).toBeDefined()
		expect(screen.queryByText(keys.viewRetry)).toBeNull()
	})

	it('offers no retry for a source that is gone', () => {
		render(<SectionError error={{ code: 'not_found' }} onRetry={() => {}} />)
		expect(screen.getByText(keys.viewErrorNotFound)).toBeDefined()
		expect(screen.queryByText(keys.viewRetry)).toBeNull()
	})

	it('points at the settings of a misconfigured source, with no retry', () => {
		render(
			<SectionError
				error={{ code: 'source_misconfigured', hostRefused: false }}
				onRetry={() => {}}
			/>
		)
		expect(screen.getByText(keys.viewErrorMisconfigured)).toBeDefined()
		expect(screen.queryByText(keys.viewRetry)).toBeNull()
	})

	it('names a refused host rather than the settings in general, with no retry', () => {
		render(
			<SectionError
				error={{ code: 'source_misconfigured', hostRefused: true }}
				onRetry={() => {}}
			/>
		)
		expect(screen.getByText(keys.viewErrorHostRefused)).toBeDefined()
		expect(screen.queryByText(keys.viewErrorMisconfigured)).toBeNull()
		expect(screen.queryByText(keys.viewRetry)).toBeNull()
	})

	it('says a read the source refuses as asked is the view to change, with no retry', () => {
		render(<SectionError error={{ code: 'invalid_param', param: 'filters' }} onRetry={() => {}} />)
		expect(screen.getByText(keys.viewErrorInvalid)).toBeDefined()
		expect(screen.queryByText(keys.viewRetry)).toBeNull()
	})

	it('says too many reports are loading for a 429, with its delay and a retry', () => {
		const onRetry = vi.fn()
		render(<SectionError error={{ code: 'rate_limited', retryAfter: 2 }} onRetry={onRetry} />)
		expect(screen.getByText(keys.viewErrorTooManyReads)).toBeDefined()
		expect(screen.getByText(retryIn('2s'))).toBeDefined()
		fireEvent.click(screen.getByText(keys.viewRetry))
		expect(onRetry).toHaveBeenCalled()
	})

	// The delay is one placeholder the sentence places, written with the language's own units.
	it('names the delay as the admin language writes a duration', () => {
		admin.language = 'de'
		render(<SectionError error={{ code: 'rate_limited', retryAfter: 90 }} onRetry={() => {}} />)
		expect(screen.getByText(retryIn('1 Min., 30 Sek.'))).toBeDefined()
	})

	it('retries any other failure, and one nothing is known about', () => {
		const onRetry = vi.fn()
		render(<SectionError error={{ code: 'failed' }} onRetry={onRetry} />)
		expect(screen.getByText(keys.viewErrorGeneric)).toBeDefined()
		fireEvent.click(screen.getByText(keys.viewRetry))
		expect(onRetry).toHaveBeenCalled()
		cleanup()
		render(<SectionError onRetry={onRetry} />)
		expect(screen.getByText(keys.viewErrorGeneric)).toBeDefined()
	})

	it('reads a section the source cannot serve as an empty state, not a failure', () => {
		render(<SectionError error={{ code: 'unsupported' }} onRetry={() => {}} />)
		expect(screen.getByText(keys.viewSectionUnavailable)).toBeDefined()
		expect(screen.queryByRole('alert')).toBeNull()
		expect(screen.queryByText(keys.viewRetry)).toBeNull()
	})
})

describe('NoSources', () => {
	it('explains the empty scope and links the setup guide', () => {
		render(<NoSources />)
		expect(screen.getByText(keys.viewNoSources)).toBeDefined()
		expect(screen.getByRole('link', { name: keys.viewDocsLink }).getAttribute('href')).toContain(
			'docs.10xmedia.de'
		)
	})

	// A reader who works per site lacks a selected site, not a connected source.
	it('asks a reader with no site selected to choose one, rather than to connect a source', () => {
		render(<NoSources needsScope />)
		expect(screen.getByText(keys.stateNoScope)).toBeDefined()
		expect(screen.queryByText(keys.viewNoSources)).toBeNull()
		expect(screen.queryByRole('link')).toBeNull()
	})
})
