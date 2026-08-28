import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LiveListBadge } from './LiveListBadge'
import { emitListFlash } from './listFlash'

vi.mock('@payloadcms/ui', () => ({
	Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
	useConfig: () => ({ config: { routes: { admin: '/admin' } } }),
}))

afterEach(() => {
	cleanup()
})

const row = (id: string) =>
	({
		cellData: id,
		collectionSlug: 'posts',
		rowData: { id },
	}) as unknown as Parameters<typeof LiveListBadge>[0]

describe('LiveListBadge', () => {
	it('flashes only the row whose id matches the signal docId', () => {
		const { container } = render(
			<>
				<LiveListBadge {...row('a')} />
				<LiveListBadge {...row('b')} />
			</>
		)

		act(() => {
			emitListFlash({ collection: 'posts', docId: 'a' })
		})

		const flashes = container.querySelectorAll('[data-sse-flash]')
		expect(flashes).toHaveLength(1)
		expect(flashes[0]?.textContent).toBe('a')
	})

	it('does not flash any row when the signal has no docId', () => {
		const { container } = render(
			<>
				<LiveListBadge {...row('a')} />
				<LiveListBadge {...row('b')} />
			</>
		)

		act(() => {
			emitListFlash({ collection: 'posts' })
		})

		expect(container.querySelectorAll('[data-sse-flash]')).toHaveLength(0)
	})
})
