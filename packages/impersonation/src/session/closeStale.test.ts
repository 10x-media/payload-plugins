import { describe, expect, it, vi } from 'vitest'

import { REGISTRY_KEY } from '../plugin/constants'
import type { ImpersonationRecord, ResolvedOptions } from '../types'
import { closeStaleImpersonations } from './closeStale'

const options = {
	access: { impersonate: () => true, readRecords: () => false, terminate: () => false },
	apiPath: '/impersonation',
	collectionSlug: 'impersonation-sessions',
	cookies: { clearOnSwitch: [] },
	decorateRequests: true,
	hintCookieName: 'impersonation-hint',
	maxDuration: undefined,
	reason: 'off',
	security: { trustedOrigins: [] },
	session: {},
	targets: undefined,
	ui: { bar: false, documentAction: false, headerAction: false, recordAction: false },
} satisfies ResolvedOptions

const row = {
	id: '1',
	impersonator: { relationTo: 'users', value: 'admin' },
	impersonatorSid: 'imp-sid',
	mode: 'swap',
	startedAt: new Date().toISOString(),
	target: { relationTo: 'users', value: 'target' },
	targetSid: 'target-sid',
} satisfies ImpersonationRecord

describe('closeStaleImpersonations', () => {
	it('skips the row when the target lookup throws', async () => {
		const update = vi.fn()
		const logger = { error: vi.fn() }
		const payload = {
			collections: { users: { config: { auth: true, slug: 'users' } } },
			config: { custom: { [REGISTRY_KEY]: options } },
			db: {
				findOne: vi.fn(async () => {
					throw new Error('blip')
				}),
			},
			find: vi.fn(async () => ({ docs: [row] })),
			logger,
			update,
		}

		const closed = await closeStaleImpersonations(payload as never)
		expect(closed).toBe(0)
		expect(update).not.toHaveBeenCalled()
		expect(logger.error).toHaveBeenCalled()
	})
})
