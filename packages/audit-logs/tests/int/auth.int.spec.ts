import { type BootedPayload, bootPayload } from '@10x-media/payload-test-harness'
import { AuthenticationError, LockedAuth, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auditLogs } from '../../src/index'
import { posts, readLogs, seedUser, TEST_EMAIL, TEST_PASSWORD, tags, users } from './fixtures'

const boot = (options: Parameters<typeof auditLogs>[0]) =>
	bootPayload({
		plugin: auditLogs(options),
		db: 'mongo',
		collections: [posts, tags, users],
		seed: async (payload) => {
			await seedUser(payload)
		},
	})

const login = (booted: BootedPayload) =>
	booted.payload.login({
		collection: 'users',
		data: { email: TEST_EMAIL, password: TEST_PASSWORD },
	})

describe('auth events are opt-in', () => {
	it('logs nothing when the collection is not listed', async () => {
		const booted = await boot({ collections: { posts: { auditLog: true } } })
		try {
			await login(booted)
			expect(await readLogs(booted.payload)).toHaveLength(0)
		} finally {
			await booted.stop()
		}
	})

	it('logs nothing when the collection is listed without auth', async () => {
		const booted = await boot({ collections: { users: { auditLog: true } } })
		try {
			await login(booted)
			expect(await readLogs(booted.payload, { operation: { equals: 'auth' } })).toHaveLength(0)
		} finally {
			await booted.stop()
		}
	})
})

describe('auth: true', () => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await boot({ collections: { users: { auth: true } } })
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('logs a successful login', async () => {
		await login(booted)

		const logs = await readLogs(booted.payload, { operation: { equals: 'auth' } })
		expect(logs.map((l) => l.eventType)).toContain('login')
		expect(logs[0]?.relationTo).toBe('users')
	})

	it('logs a forgot-password request with the submitted email', async () => {
		await booted.payload.forgotPassword({
			collection: 'users',
			data: { email: TEST_EMAIL },
			disableEmail: true,
		})

		const logs = await readLogs(booted.payload, { eventType: { equals: 'forgot_password' } })
		expect(logs).toHaveLength(1)
		expect(logs[0]?.metadata?.email).toBe(TEST_EMAIL)
	})

	it('does not log a failed login', async () => {
		const before = (await readLogs(booted.payload, { operation: { equals: 'auth' } })).length

		await expect(
			booted.payload.login({
				collection: 'users',
				data: { email: TEST_EMAIL, password: 'wrong' },
			})
		).rejects.toThrow()

		const after = (await readLogs(booted.payload, { operation: { equals: 'auth' } })).length
		expect(after).toBe(before)
	})
})

describe('auth as an object picks per event', () => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await boot({
			collections: { users: { auth: { login: true, forgotPassword: false } } },
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('logs the login', async () => {
		await login(booted)
		expect(await readLogs(booted.payload, { eventType: { equals: 'login' } })).toHaveLength(1)
	})

	it('leaves the forgot-password event out', async () => {
		await booted.payload.forgotPassword({
			collection: 'users',
			data: { email: TEST_EMAIL },
			disableEmail: true,
		})

		expect(
			await readLogs(booted.payload, { eventType: { equals: 'forgot_password' } })
		).toHaveLength(0)
	})
})

describe('shorthand', () => {
	it('enables auth events along with everything else', async () => {
		const booted = await boot({ collections: { users: true } })
		try {
			await login(booted)
			expect(await readLogs(booted.payload, { eventType: { equals: 'login' } })).toHaveLength(1)
		} finally {
			await booted.stop()
		}
	})
})

/**
 * The failed-login entry is written from the collection's `afterError` hook, which only
 * Payload's REST layer calls (`routeError`). `payload.login()` throws straight to the
 * caller, so these drive the registered hook directly with the request REST would have
 * handed it. The full HTTP path is covered in e2e.
 */
describe('failed logins', () => {
	const authError = new AuthenticationError()

	const failedLoginReq = (data: Record<string, unknown> = { email: 'attacker@evil.test' }) =>
		({
			data,
			headers: new Headers({ 'x-forwarded-for': '203.0.113.7' }),
			pathname: '/api/users/login',
			payloadAPI: 'REST',
		}) as unknown as PayloadRequest

	const fireAfterError = async (
		booted: BootedPayload,
		{ error = authError, req = failedLoginReq() }: { error?: Error; req?: PayloadRequest } = {}
	) => {
		const collection = booted.payload.collections.users?.config
		const hooks = collection?.hooks.afterError ?? []
		for (const hook of hooks) {
			await hook({
				collection: collection as never,
				context: {},
				error,
				req: Object.assign(req, { payload: booted.payload }),
			})
		}
		return hooks.length
	}

	it('registers no hook until failedLogin is asked for by name', async () => {
		const booted = await boot({ collections: { users: { auth: true } } })
		try {
			expect(booted.payload.collections.users?.config.hooks.afterError ?? []).toHaveLength(0)
		} finally {
			await booted.stop()
		}
	})

	it('records the attempt without a user, since Payload will not say who it was', async () => {
		const booted = await boot({ collections: { users: { auth: { failedLogin: true } } } })
		try {
			await fireAfterError(booted)

			const [log] = await readLogs(booted.payload, { eventType: { equals: 'failed_login' } })
			expect(log?.operation).toBe('auth')
			expect(log?.relationTo).toBe('users')
			expect(log?.user).toBeFalsy()
			expect(log?.documentId).toBeFalsy()
			expect(log?.ipAddress).toBe('203.0.113.7')
			expect(log?.metadata).toMatchObject({
				identifier: 'attacker@evil.test',
				reason: 'invalid_credentials',
			})
		} finally {
			await booted.stop()
		}
	})

	it('never lets the submitted password reach the row', async () => {
		const booted = await boot({ collections: { users: { auth: { failedLogin: true } } } })
		try {
			await fireAfterError(booted, {
				req: failedLoginReq({ email: 'attacker@evil.test', password: 'hunter2' }),
			})

			const [log] = await readLogs(booted.payload, { eventType: { equals: 'failed_login' } })
			expect(JSON.stringify(log)).not.toContain('hunter2')
		} finally {
			await booted.stop()
		}
	})

	it('tells a lockout apart from a wrong password', async () => {
		const booted = await boot({ collections: { users: { auth: { failedLogin: true } } } })
		try {
			await fireAfterError(booted, { error: new LockedAuth() })

			const [log] = await readLogs(booted.payload, { eventType: { equals: 'failed_login' } })
			expect(log?.metadata).toMatchObject({ reason: 'locked' })
		} finally {
			await booted.stop()
		}
	})

	// The hook is attached to the collection, not to one endpoint, so everything else the
	// collection can fail with has to fall through it.
	it('ignores errors that are not a refused login', async () => {
		const booted = await boot({ collections: { users: { auth: { failedLogin: true } } } })
		try {
			await fireAfterError(booted, { error: new Error('unrelated') })
			await fireAfterError(booted, {
				req: failedLoginReq({ email: 'a@b.c' }),
				error: authError,
			})
			const off = failedLoginReq()
			Object.assign(off, { pathname: '/api/users/refresh-token' })
			await fireAfterError(booted, { req: off })

			expect(
				await readLogs(booted.payload, { eventType: { equals: 'failed_login' } })
			).toHaveLength(1)
		} finally {
			await booted.stop()
		}
	})

	it('lets the host suppress the write, so a burst can be deduped or just alerted on', async () => {
		const seen: string[] = []
		const booted = await boot({
			collections: {
				users: {
					auth: {
						failedLogin: {
							shouldLog: ({ identifier, reason }) => {
								seen.push(`${reason}:${identifier}`)
								return false
							},
						},
					},
				},
			},
		})
		try {
			await fireAfterError(booted)

			expect(seen).toEqual(['invalid_credentials:attacker@evil.test'])
			expect(
				await readLogs(booted.payload, { eventType: { equals: 'failed_login' } })
			).toHaveLength(0)
		} finally {
			await booted.stop()
		}
	})
})
