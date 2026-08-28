import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { sse } from '../../src/index'
import { loginUser, openStream, readUntil } from './helpers/rest'

const users: CollectionConfig = { slug: 'users', auth: true, fields: [] }

/** Filled after seed so collection-wide subscribe is allowed but findByID is document-scoped. */
let post1Id: string | number | undefined

const posts: CollectionConfig = {
	slug: 'posts',
	fields: [{ name: 'title', type: 'text' }],
	access: {
		read: ({ req, id }) => {
			if (id == null) return Boolean(req.user)
			const email = (req.user as { email?: string } | null)?.email
			if (email === 'a@t.dev') return String(id) === String(post1Id)
			return false
		},
	},
}

const parseUpdateFrames = (buf: string): Array<{ docId?: string; data?: { doc?: unknown } }> => {
	const frames: Array<{ docId?: string; data?: { doc?: unknown } }> = []
	for (const block of buf.split('\n\n')) {
		if (!block.includes('event: update')) continue
		const dataLine = block.split('\n').find((line) => line.startsWith('data: '))
		if (!dataLine) continue
		frames.push(
			JSON.parse(dataLine.slice('data: '.length)) as {
				docId?: string
				data?: { doc?: unknown }
			}
		)
	}
	return frames
}

describeForDb('sse access-safe enrichment', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	let tokenA: string
	let tokenB: string
	let seededPost1Id: string | number
	let seededPost2Id: string | number

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: sse({ collections: { posts: { thinEvents: false } } }),
			db,
			collections: [users, posts],
		})
		tokenA = await loginUser(booted, 'a@t.dev')
		tokenB = await loginUser(booted, 'b@t.dev')

		const post1 = await booted.payload.create({
			collection: 'posts',
			data: { title: 'post-1' },
			overrideAccess: true,
		})
		const post2 = await booted.payload.create({
			collection: 'posts',
			data: { title: 'post-2' },
			overrideAccess: true,
		})
		post1Id = post1.id
		seededPost1Id = post1.id
		seededPost2Id = post2.id
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it('only A gets doc for post-1; neither gets doc for post-2; both get thin updates', async () => {
		const acA = new AbortController()
		const acB = new AbortController()

		const resA = await openStream({
			booted,
			token: tokenA,
			topics: 'posts',
			signal: acA.signal,
		})
		const resB = await openStream({
			booted,
			token: tokenB,
			topics: 'posts',
			signal: acB.signal,
		})
		expect(resA.status).toBe(200)
		expect(resB.status).toBe(200)

		const readerA = resA.body?.getReader()
		const readerB = resB.body?.getReader()
		if (!readerA || !readerB) throw new Error('missing body')

		await readUntil(readerA, (buf) => buf.includes('event: ready'))
		await readUntil(readerB, (buf) => buf.includes('event: ready'))

		await booted.payload.update({
			collection: 'posts',
			id: seededPost1Id,
			data: { title: 'post-1-updated' },
			overrideAccess: true,
		})
		await booted.payload.update({
			collection: 'posts',
			id: seededPost2Id,
			data: { title: 'post-2-updated' },
			overrideAccess: true,
		})

		const verify = await booted.payload.findByID({
			collection: 'posts',
			id: seededPost1Id,
			overrideAccess: true,
		})
		expect((verify as { title?: string }).title).toBe('post-1-updated')

		const bodyA = await readUntil(
			readerA,
			(buf) =>
				buf.includes(`"docId":"${seededPost1Id}"`) &&
				buf.includes(`"docId":"${seededPost2Id}"`) &&
				(buf.match(/"operation":"update"/g) ?? []).length >= 2
		)
		const bodyB = await readUntil(
			readerB,
			(buf) =>
				buf.includes(`"docId":"${seededPost1Id}"`) &&
				buf.includes(`"docId":"${seededPost2Id}"`) &&
				(buf.match(/"operation":"update"/g) ?? []).length >= 2
		)

		const framesA = parseUpdateFrames(bodyA)
		const framesB = parseUpdateFrames(bodyB)

		const aPost1 = framesA.find((f) => String(f.docId) === String(seededPost1Id))
		const aPost2 = framesA.find((f) => String(f.docId) === String(seededPost2Id))
		const bPost1 = framesB.find((f) => String(f.docId) === String(seededPost1Id))
		const bPost2 = framesB.find((f) => String(f.docId) === String(seededPost2Id))

		expect(aPost1).toBeDefined()
		expect(aPost2).toBeDefined()
		expect(bPost1).toBeDefined()
		expect(bPost2).toBeDefined()

		expect(aPost1?.data?.doc).toBeDefined()
		expect(String((aPost1?.data?.doc as { id?: unknown })?.id)).toBe(String(seededPost1Id))
		expect((aPost1?.data?.doc as { title?: string })?.title).toBe('post-1-updated')
		expect(aPost2?.data?.doc).toBeUndefined()
		expect(bPost1?.data?.doc).toBeUndefined()
		expect(bPost2?.data?.doc).toBeUndefined()

		acA.abort()
		acB.abort()
		await readerA.cancel().catch(() => {})
		await readerB.cancel().catch(() => {})
	})
})
