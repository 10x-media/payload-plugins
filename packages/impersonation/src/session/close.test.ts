import { describe, expect, it, vi } from 'vitest'

import type { ImpersonationRecord, ResolvedOptions } from '../types'
import { closeRecord } from './close'

const options = {
	access: {
		impersonate: () => true,
		readRecords: () => false,
		recordsListed: false,
		terminate: () => false,
	},
	apiPath: '/impersonation',
	collectionSlug: 'impersonation-sessions',
	cookies: { clearOnSwitch: [] },
	decorateRequests: true,
	hintCookieName: 'impersonation-hint',
	maxDuration: undefined,
	reason: 'off',
	retention: undefined,
	security: { trustedOrigins: [] },
	session: {},
	targets: undefined,
	ui: {
		bar: false,
		cardEmail: false,
		documentAction: false,
		headerAction: false,
		recordAction: false,
	},
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

describe('closeRecord', () => {
	it('falls back to db.updateOne when payload.update rejects', async () => {
		const update = vi.fn(async () => {
			throw Object.assign(new Error('invalid'), { status: 400 })
		})
		const updateOne = vi.fn(async () => null)
		const onEnd = vi.fn()
		const payload = { db: { updateOne }, update }

		const result = await closeRecord({
			endedBy: 'impersonatorGone',
			options: { ...options, onEnd },
			payload: payload as never,
			record: row,
		})

		expect(updateOne).toHaveBeenCalledWith(
			expect.objectContaining({
				id: row.id,
				collection: options.collectionSlug,
				data: expect.objectContaining({ endedBy: 'impersonatorGone' }),
				returning: false,
			})
		)
		expect(result.endedBy).toBe('impersonatorGone')
		expect(onEnd).toHaveBeenCalled()
	})
})
