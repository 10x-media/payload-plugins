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

describeForDb('sse reconnect', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	let token: string

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: sse({ collections: { posts: true } }),
			db,
			collections: [users, posts],
		})
		token = await loginUser(booted, 'reconnect@t.dev')
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it('reconnects with ready and Local API sees docs written while disconnected (no replay)', async () => {
		const firstAc = new AbortController()
		const firstRes = await openStream({
			booted,
			token,
			topics: 'posts',
			signal: firstAc.signal,
		})
		expect(firstRes.status).toBe(200)
		const firstReader = firstRes.body?.getReader()
		if (!firstReader) throw new Error('missing body')
		await readUntil(firstReader, (buf) => buf.includes('event: ready'))

		firstAc.abort()
		await firstReader.cancel().catch(() => {})

		const created = await booted.payload.create({
			collection: 'posts',
			data: { title: 'while-offline' },
		})

		const found = await booted.payload.findByID({
			collection: 'posts',
			id: created.id,
		})
		expect(found.title).toBe('while-offline')

		const secondAc = new AbortController()
		const secondRes = await openStream({
			booted,
			token,
			topics: 'posts',
			signal: secondAc.signal,
		})
		expect(secondRes.status).toBe(200)
		const secondReader = secondRes.body?.getReader()
		if (!secondReader) throw new Error('missing body')

		const body = await readUntil(secondReader, (buf) => buf.includes('event: ready'))
		expect(body).toContain('event: ready')
		expect(body).not.toContain('"operation":"create"')
		expect(body).not.toContain('while-offline')

		secondAc.abort()
		await secondReader.cancel().catch(() => {})
	})
})
