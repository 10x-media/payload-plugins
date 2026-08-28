import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { sse } from '../../src/index'
import { loginUser, openStream, readUntil } from './helpers/rest'

const users: CollectionConfig = { slug: 'users', auth: true, fields: [] }

const posts: CollectionConfig = {
	slug: 'posts',
	fields: [{ name: 'title', type: 'text' }],
	access: { read: () => true },
}

describeForDb('sse hooks emit', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	let token: string

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: sse({ collections: { posts: true } }),
			db,
			collections: [users, posts],
		})
		token = await loginUser(booted, 'hooks-emit@t.dev')
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it('stream receives create, update, and delete thin events', async () => {
		const ac = new AbortController()
		const res = await openStream({
			booted,
			token,
			topics: 'posts',
			signal: ac.signal,
		})
		expect(res.status).toBe(200)
		const reader = res.body?.getReader()
		if (!reader) throw new Error('missing body')

		await readUntil(reader, (buf) => buf.includes('event: ready'))

		const created = await booted.payload.create({
			collection: 'posts',
			data: { title: 'one' },
		})
		const docId = String(created.id)

		await booted.payload.update({
			collection: 'posts',
			id: created.id,
			data: { title: 'two' },
		})

		await booted.payload.delete({
			collection: 'posts',
			id: created.id,
		})

		const body = await readUntil(
			reader,
			(buf) =>
				buf.includes('"operation":"create"') &&
				buf.includes('"operation":"update"') &&
				buf.includes('"operation":"delete"')
		)

		expect(body).toContain('event: create')
		expect(body).toContain('event: update')
		expect(body).toContain('event: delete')
		expect(body).toContain(`"docId":"${docId}"`)
		expect(body).toContain('"topic":"posts"')

		ac.abort()
		await reader.cancel().catch(() => {})
	})
})
