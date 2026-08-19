import type { Collection, PayloadRequest, TypedUser } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import type { ResolvedIsolatedCollection } from '../types'
import { warnIfAdminMisclassified } from './misclassification'

const STAFF_COOKIE = 'payload-staff-token'
const SHARED_COOKIE = 'payload-token'

const admin = { email: 'admin@10xmedia.de', id: 1 } as unknown as TypedUser

const entry: ResolvedIsolatedCollection = {
	slug: 'staff' as ResolvedIsolatedCollection['slug'],
	cookieName: STAFF_COOKIE,
	isolate: () => true,
	scopes: ['frontend'],
}

const collection = (admin?: (args: { req: PayloadRequest }) => boolean | Promise<boolean>) =>
	({ config: { slug: 'staff', access: admin ? { admin } : {} } }) as unknown as Collection

const request = () => {
	const warn = vi.fn()
	const req = { payload: { logger: { warn } }, user: null } as unknown as PayloadRequest
	return { req, warn }
}

describe('warnIfAdminMisclassified', () => {
	it('warns when a user routed to the isolated cookie can reach the admin panel', async () => {
		const { req, warn } = request()

		await warnIfAdminMisclassified({
			collection: collection(() => true),
			cookieName: STAFF_COOKIE,
			entry,
			req,
			user: admin,
		})

		expect(warn).toHaveBeenCalledOnce()
		expect(warn.mock.calls[0]?.[0]).toContain(STAFF_COOKIE)
		expect(warn.mock.calls[0]?.[0]).toContain('admin@10xmedia.de')
	})

	it('says nothing about a user the predicate left on the shared cookie', async () => {
		const { req, warn } = request()

		await warnIfAdminMisclassified({
			collection: collection(() => true),
			cookieName: SHARED_COOKIE,
			entry,
			req,
			user: admin,
		})

		expect(warn).not.toHaveBeenCalled()
	})

	it('says nothing when the classification agrees with `access.admin`', async () => {
		const { req, warn } = request()

		await warnIfAdminMisclassified({
			collection: collection(() => false),
			cookieName: STAFF_COOKIE,
			entry,
			req,
			user: admin,
		})

		expect(warn).not.toHaveBeenCalled()
	})

	it('stays quiet for a collection that defines no admin gate to compare against', async () => {
		const { req, warn } = request()

		await warnIfAdminMisclassified({
			collection: collection(),
			cookieName: STAFF_COOKIE,
			entry,
			req,
			user: admin,
		})

		expect(warn).not.toHaveBeenCalled()
	})

	it('asks the gate about the user who just logged in, not the request', async () => {
		const { req, warn } = request()
		const seen: (null | TypedUser)[] = []

		await warnIfAdminMisclassified({
			collection: collection(({ req: given }) => {
				seen.push(given.user)
				return true
			}),
			cookieName: STAFF_COOKIE,
			entry,
			req,
			user: admin,
		})

		expect(seen).toEqual([admin])
		// And puts the request back the way it found it: the login response still has to
		// answer for whoever actually made the call.
		expect(req.user).toBeNull()
		expect(warn).toHaveBeenCalledOnce()
	})

	it('treats a gate that throws as a refusal', async () => {
		const { req, warn } = request()

		await warnIfAdminMisclassified({
			collection: collection(() => {
				throw new Error('Unauthorized')
			}),
			cookieName: STAFF_COOKIE,
			entry,
			req,
			user: admin,
		})

		expect(warn).not.toHaveBeenCalled()
		expect(req.user).toBeNull()
	})
})
