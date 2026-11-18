import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { Payload } from 'payload'
import { type ComponentProps, isValidElement, type ReactElement } from 'react'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

import { impersonation } from '../../src/index'
import type { ImpersonationBar } from '../../src/ui/ImpersonationBar'
import { ImpersonationProvider } from '../../src/ui/ImpersonationProvider'
import { createRestClient } from './helpers/rest'

// The client components pull in @payloadcms/ui, which does not load outside Next.
vi.mock('../../src/ui/ImpersonationBar', () => ({ ImpersonationBar: () => null }))
vi.mock('../../src/ui/ImpersonationConfig', () => ({ ImpersonationClientConfig: () => null }))

const ADMIN = { email: 'admin@10xmedia.de', password: 'password' }
const TARGET = { email: 'target@10xmedia.de', password: 'password' }

type BarElement = ReactElement<ComponentProps<typeof ImpersonationBar>>

const isBar = (node: unknown): node is BarElement =>
	isValidElement<Partial<ComponentProps<typeof ImpersonationBar>>>(node) &&
	typeof node.props.actingAs === 'string'

const seed = async (payload: Payload) => {
	await payload.create({ collection: 'users', data: ADMIN })
	await payload.create({ collection: 'users', data: TARGET })
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

		const children = isValidElement<{ children?: unknown }>(tree) ? tree.props.children : []
		const bar = (Array.isArray(children) ? children : [children]).find(isBar)
		expect(bar?.props.impersonatorLocale).toBe('de')
		expect(bar?.props.messages?.expandBar).toBe('Impersonation-Leiste ausklappen')
	})
})
