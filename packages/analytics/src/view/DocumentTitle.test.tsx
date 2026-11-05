import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DocumentTitle } from './DocumentTitle'

afterEach(() => {
	cleanup()
	document.title = ''
})

/** What Next does when its metadata streams in after the view mounted. */
const nextWrites = async (title: string): Promise<void> => {
	await act(async () => {
		document.title = title
		await Promise.resolve()
	})
}

describe('DocumentTitle', () => {
	it("names the browser tab in the reader's language, and follows a new title", () => {
		document.title = 'Analytics - Payload'
		const { rerender } = render(<DocumentTitle title="Statistiken - Payload" />)
		expect(document.title).toBe('Statistiken - Payload')
		rerender(<DocumentTitle title="الإحصاءات - Payload" />)
		expect(document.title).toBe('الإحصاءات - Payload')
	})

	it('renames the tab again when the app writes its own title later', async () => {
		render(<DocumentTitle title="Statistiken - Payload" />)
		await nextWrites('Analytics - Payload')
		expect(document.title).toBe('Statistiken - Payload')
	})

	it('leaves the next page its own title once the view is gone', async () => {
		const { unmount } = render(<DocumentTitle title="Statistiken - Payload" />)
		unmount()
		await nextWrites('Dashboard - Payload')
		expect(document.title).toBe('Dashboard - Payload')
	})

	it('draws nothing', () => {
		const { container } = render(<DocumentTitle title="Analytics" />)
		expect(container.innerHTML).toBe('')
	})
})
