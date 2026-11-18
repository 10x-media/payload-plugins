import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { Payload } from 'payload'
import { type ComponentProps, isValidElement } from 'react'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

import { impersonation } from '../../src/index'
import type { ImpersonationClientConfig } from '../../src/ui/ImpersonationConfig'
import { ImpersonationProvider } from '../../src/ui/ImpersonationProvider'
import { createRestClient } from './helpers/rest'

// The client components pull in @payloadcms/ui, which does not load outside Next.
vi.mock('../../src/ui/ImpersonationConfig', () => ({ ImpersonationClientConfig: () => null }))
vi.mock('../../src/ui/ImpersonationHeader', () => ({ ImpersonationFixedBar: () => null }))

const ADMIN = { email: 'admin@10xmedia.de', password: 'password' }
const TARGET = { email: 'target@10xmedia.de', password: 'password' }

const seed = async (payload: Payload) => {
	await payload.create({ collection: 'users', data: ADMIN, overrideAccess: true })
	await payload.create({ collection: 'users', data: TARGET, overrideAccess: true })
}

describeForDb('impersonation bar locale', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [{ slug: 'users', auth: true, fields: [] }],
			configOverrides: { admin: { user: 'users' } },
			db,
			plugin: impersonation({ access: { impersonate: () => true } }),
			seed,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('follows the admin language, not the one the session started in', async () => {
		const client = createRestClient(booted)
		await client.post('/api/users/login', { body: ADMIN })
		const target = await booted.payload.find({
			collection: 'users',
			overrideAccess: true,
			where: { email: { equals: TARGET.email } },
		})
		const start = await client.post('/api/impersonation/start', {
			body: { collection: 'users', id: target.docs[0]?.id },
		})
		expect(start.status).toBe(200)

		const cookie = [...client.jar].map(([name, value]) => `${name}=${value}`).join('; ')
		const { user } = await booted.payload.auth({ headers: new Headers({ cookie }) })
		const tree = await ImpersonationProvider({
			i18n: { language: 'de' },
			payload: booted.payload,
			user,
		} as never)

		// The bar reads what it shows from the client config.
		const bar = isValidElement<Partial<ComponentProps<typeof ImpersonationClientConfig>>>(tree)
			? tree.props.value?.bar
			: undefined
		expect(bar?.impersonatorLocale).toBe('de')
		expect(bar?.actingAs).toBe('Handelt als target@10xmedia.de')
		expect(bar?.messages?.errors.failed).toBe('Impersonation fehlgeschlagen')
	})
})
