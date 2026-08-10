import { type BootedPayload, bootPayload } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auditLogs } from '../../src/index'
import { posts, readLogs, seedUser, TEST_EMAIL, TEST_PASSWORD, tags, users } from './fixtures'

describe('auth event logging', () => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: auditLogs({ collections: { posts: { auditLog: true } } }),
			db: 'mongo',
			collections: [posts, tags, users],
			seed: async (payload) => {
				await seedUser(payload)
			},
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('logs a successful login', async () => {
		await booted.payload.login({
			collection: 'users',
			data: { email: TEST_EMAIL, password: TEST_PASSWORD },
		})

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

describe('auth logging disabled', () => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: auditLogs({ auth: false, collections: { posts: { auditLog: true } } }),
			db: 'mongo',
			collections: [posts, tags, users],
			seed: async (payload) => {
				await seedUser(payload)
			},
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('writes no entry for a login when auth is false', async () => {
		await booted.payload.login({
			collection: 'users',
			data: { email: TEST_EMAIL, password: TEST_PASSWORD },
		})

		const logs = await readLogs(booted.payload, { operation: { equals: 'auth' } })
		expect(logs).toHaveLength(0)
	})
})
