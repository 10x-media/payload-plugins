import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { multiTenantPlugin } from '@payloadcms/plugin-multi-tenant'
import type { CollectionConfig } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { sse } from '../../src/index'
import { loginUser, openStream, readUntil } from './helpers/rest'

const users: CollectionConfig = { slug: 'users', auth: true, fields: [] }

const tenants: CollectionConfig = {
	slug: 'tenants',
	fields: [{ name: 'name', type: 'text', required: true }],
}

const posts: CollectionConfig = {
	slug: 'posts',
	fields: [{ name: 'title', type: 'text', required: true }],
}

describeForDb('sse multiTenantScope adapter', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	let token: string
	let tenantA: string
	let tenantB: string

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: sse({
				collections: { posts: true },
				scope: true,
			}),
			db,
			collections: [users, tenants, posts],
			configOverrides: {
				plugins: [
					multiTenantPlugin({
						collections: { posts: {} },
						userHasAccessToAllTenants: () => false,
					}),
				],
			},
		})

		const a = await booted.payload.create({ collection: 'tenants', data: { name: 'A' } })
		const b = await booted.payload.create({ collection: 'tenants', data: { name: 'B' } })
		tenantA = String(a.id)
		tenantB = String(b.id)
		token = await loginUser(booted, 'mt-a@t.dev')
		const user = await booted.payload.find({
			collection: 'users',
			where: { email: { equals: 'mt-a@t.dev' } },
			limit: 1,
		})
		const userId = user.docs[0]?.id
		if (userId == null) throw new Error('missing user')
		await booted.payload.update({
			collection: 'users',
			id: userId,
			data: { tenants: [{ tenant: a.id }] } as never,
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it('isolates collection-wide events by the payload-tenant cookie after plugin-multi-tenant', async () => {
		const ac = new AbortController()
		const res = await openStream({
			booted,
			token,
			topics: 'posts',
			signal: ac.signal,
			headers: { Cookie: `payload-tenant=${tenantA}` },
		})
		expect(res.status).toBe(200)
		const reader = res.body?.getReader()
		if (!reader) throw new Error('missing body')
		await readUntil(reader, (buf) => buf.includes('event: ready'))

		await booted.payload.create({
			collection: 'posts',
			data: { title: 'b-secret', tenant: tenantB } as never,
			overrideAccess: true,
		})
		const ours = await booted.payload.create({
			collection: 'posts',
			data: { title: 'a-visible', tenant: tenantA } as never,
			overrideAccess: true,
		})

		const body = await readUntil(reader, (buf) => buf.includes(`"docId":"${String(ours.id)}"`))
		expect(body).toContain('"topic":"posts"')
		expect(body).not.toContain('b-secret')
		ac.abort()
		await reader.cancel().catch(() => {})
	})

	it('refuses the stream when the payload-tenant cookie is a tenant the user is not assigned to', async () => {
		const res = await openStream({
			booted,
			token,
			topics: 'posts',
			headers: { Cookie: `payload-tenant=${tenantB}` },
		})
		expect(res.status).toBe(403)
	})
})
