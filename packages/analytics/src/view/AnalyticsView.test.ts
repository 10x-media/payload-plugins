import type { AdminViewServerProps } from 'payload'
import { isValidElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../plugin/runtime', () => ({
	runtimeFactoryOf: () => ({ resolved: { view: false } }),
}))
vi.mock('./viewProps', () => ({
	resolveViewProps: async () => ({ denied: true }),
}))

const { AnalyticsView } = await import('./AnalyticsView')

describe('AnalyticsView', () => {
	it('hands the template the user Payload read for the view, not the raw request user', async () => {
		const raw = { id: 1, collection: 'users', email: 'a@t.dev', secret: 'hash' }
		const filtered = { id: 1, collection: 'users', email: 'a@t.dev' }
		const req = {
			user: raw,
			i18n: { t: (key: string) => key, language: 'en', fallbackLanguage: 'en' },
			payload: { config: { admin: {} }, logger: { warn: () => {} } },
		}
		const props = {
			initPageResult: {
				req,
				locale: undefined,
				permissions: {},
				visibleEntities: { collections: [], globals: [] },
			},
			user: filtered,
		} as unknown as AdminViewServerProps
		const element = await AnalyticsView(props)
		expect(isValidElement(element)).toBe(true)
		expect((element.props as { user?: unknown }).user).toBe(filtered)
	})
})
