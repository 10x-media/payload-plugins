import { type BootedPayload, bootPayload } from '@10x-media/payload-test-harness'
import type { CollectionConfig, GlobalConfig, PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auditLogs } from '../../src/index'
import { fieldNamed, PLUGIN_FIELD, posts, seedUser, siteSettings, tags, users } from './fixtures'

/** Turns Payload's `updatedBy` off for itself; the plugin must not bring it back. */
const notes: CollectionConfig = {
	slug: 'notes',
	authorship: { updatedBy: false },
	fields: [{ name: 'body', type: 'text' }],
}

/** Declares its own `createdBy`, which the plugin must leave as declared. */
const pages: CollectionConfig = {
	slug: 'pages',
	fields: [
		{ name: 'title', type: 'text' },
		{ name: 'createdBy', type: 'relationship', relationTo: 'users', admin: { hidden: true } },
	],
}

/**
 * A copy with a field list of its own. Sanitizing pushes Payload's authorship fields
 * into the array it was given, so a second boot of the shared fixtures would find
 * them declared. Taken at import, before either boot.
 */
const fresh = <T extends { fields: unknown[] }>(entity: T): T => ({
	...entity,
	fields: [...entity.fields],
})
const listedBoot = { posts: fresh(posts), siteSettings: fresh(siteSettings), tags: fresh(tags) }
const everyBoot = {
	posts: fresh(posts),
	siteSettings: fresh(siteSettings),
	tags: fresh(tags),
	users: fresh(users),
}

const unlisted: GlobalConfig = { slug: 'unlisted', fields: [{ name: 'x', type: 'text' }] }

describe('authorshipFields', () => {
	let booted: BootedPayload
	let req: PayloadRequest
	let userId: string

	const fieldOf = (slug: string, name: string) =>
		fieldNamed(booted.payload.collections[slug]?.config.fields, name)
	const globalFieldOf = (slug: string, name: string) =>
		fieldNamed(booted.payload.config.globals.find((g) => g.slug === slug)?.fields, name)

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: auditLogs({
				authorshipFields: { collections: ['posts', 'notes', 'pages'], globals: ['site-settings'] },
				collections: { posts: { auditLog: true } },
			}),
			db: 'mongo',
			collections: [listedBoot.posts, listedBoot.tags, users, notes, pages],
			configOverrides: { globals: [listedBoot.siteSettings, unlisted] },
			seed: async (payload) => {
				const user = await seedUser(payload)
				userId = String(user.id)
				req = { user: { ...user, collection: 'users' } } as unknown as PayloadRequest
			},
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it("shows Payload's createdBy and updatedBy through the plugin's component", () => {
		for (const name of ['createdBy', 'updatedBy']) {
			const field = fieldOf('posts', name)
			expect(field?.admin?.hidden, name).toBe(false)
			expect(field?.admin?.components?.Field, name).toBe(PLUGIN_FIELD)
			expect(field?.relationTo, name).toEqual(['users'])
		}
	})

	it('keeps Payload stamping them', async () => {
		const doc = await booted.payload.create({
			collection: 'posts',
			data: { title: 'Stamped' },
			depth: 0,
			req,
		})

		expect(doc.createdBy).toEqual({ relationTo: 'users', value: doc.createdBy?.value })
		expect(String(doc.createdBy?.value)).toBe(userId)
		expect(String(doc.updatedBy?.value)).toBe(userId)
	})

	it('leaves the fields of an unlisted collection hidden', () => {
		const field = fieldOf('tags', 'createdBy')
		expect(field?.admin?.hidden).toBe(true)
		expect(field?.admin?.components?.Field).toBeUndefined()
	})

	it('adds nothing a collection switched off in its authorship', () => {
		expect(fieldOf('notes', 'updatedBy')).toBeUndefined()
		expect(fieldOf('notes', 'createdBy')?.admin?.components?.Field).toBe(PLUGIN_FIELD)
	})

	it('leaves a declared field as declared', () => {
		const field = fieldOf('pages', 'createdBy')
		expect(field?.admin?.hidden).toBe(true)
		expect(field?.admin?.components?.Field).toBeUndefined()
		expect(fieldOf('pages', 'updatedBy')?.admin?.components?.Field).toBe(PLUGIN_FIELD)
	})

	it('covers the listed globals only', () => {
		expect(globalFieldOf('site-settings', 'updatedBy')?.admin?.components?.Field).toBe(PLUGIN_FIELD)
		expect(globalFieldOf('unlisted', 'updatedBy')?.admin?.components?.Field).toBeUndefined()
	})

	it('keeps authorship off the log itself', () => {
		expect(fieldOf('audit-logs', 'createdBy')).toBeUndefined()
		expect(fieldOf('audit-logs', 'updatedBy')).toBeUndefined()
	})
})

describe('authorshipFields: true', () => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: auditLogs({ authorshipFields: true }),
			db: 'mongo',
			collections: [everyBoot.posts, everyBoot.tags, everyBoot.users],
			configOverrides: { globals: [everyBoot.siteSettings] },
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('covers every collection and global', () => {
		for (const slug of ['posts', 'tags', 'users']) {
			const field = fieldNamed(booted.payload.collections[slug]?.config.fields, 'updatedBy')
			expect(field?.admin?.components?.Field, slug).toBe(PLUGIN_FIELD)
		}
		const global = booted.payload.config.globals.find((g) => g.slug === 'site-settings')
		expect(fieldNamed(global?.fields, 'createdBy')?.admin?.components?.Field).toBe(PLUGIN_FIELD)
	})
})
