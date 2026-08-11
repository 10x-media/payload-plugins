import { type BootedPayload, bootPayload } from '@10x-media/payload-test-harness'
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
