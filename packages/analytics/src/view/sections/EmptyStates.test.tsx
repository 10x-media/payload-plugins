import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryFetchError } from '../../query/fetchQuery'
import { keys } from '../../translations/keys'
import { SECTION_UNAVAILABLE } from '../useViewQueries'
import { NoSources, SectionError } from './EmptyStates'

vi.mock('@payloadcms/ui', () => ({
	Banner: ({ children }: { children?: ReactNode }) => <div role="alert">{children}</div>,
	Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
		// biome-ignore lint/a11y/useButtonType: test double
		<button onClick={onClick}>{children}</button>
	),
	useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }),
}))

afterEach(() => {
	cleanup()
})

describe('SectionError', () => {
	it('explains a busy provider, names the retry delay, and offers a retry', () => {
		const onRetry = vi.fn()
		render(
			<SectionError
				error={new QueryFetchError(503, { code: 'unavailable', message: 'busy' }, 30)}
				onRetry={onRetry}
			/>
		)
		expect(screen.getByText(keys.viewErrorBusy)).toBeDefined()
		expect(screen.getByText(new RegExp(`${keys.viewErrorRetryAfter} 30`))).toBeDefined()
		fireEvent.click(screen.getByText(keys.viewRetry))
		expect(onRetry).toHaveBeenCalled()
	})

	it('offers no retry for a denied read', () => {
		render(
			<SectionError
				error={new QueryFetchError(403, { code: 'forbidden', message: 'no' })}
				onRetry={() => {}}
			/>
		)
		expect(screen.getByText(keys.viewErrorForbidden)).toBeDefined()
		expect(screen.queryByText(keys.viewRetry)).toBeNull()
	})

	it('offers no retry for a source that is gone', () => {
		render(
			<SectionError
				error={new QueryFetchError(404, { code: 'unknown_source', message: 'gone' })}
				onRetry={() => {}}
			/>
		)
		expect(screen.getByText(keys.viewErrorNotFound)).toBeDefined()
		expect(screen.queryByText(keys.viewRetry)).toBeNull()
	})

	it('retries any other failure', () => {
		const onRetry = vi.fn()
		render(<SectionError error={new Error('network down')} onRetry={onRetry} />)
		expect(screen.getByText(keys.viewErrorGeneric)).toBeDefined()
		fireEvent.click(screen.getByText(keys.viewRetry))
		expect(onRetry).toHaveBeenCalled()
	})

	it('reads a section the source cannot serve as an empty state, not a failure', () => {
		render(<SectionError error={new Error(SECTION_UNAVAILABLE)} onRetry={() => {}} />)
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
})
