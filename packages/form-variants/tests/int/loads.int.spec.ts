import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import {
	defineFormVariants,
	EVALUATE_PATH,
	formVariants,
	getCollectionVariants,
} from '../../src/index'
import { VIEW_PATH } from '../../src/plugin/constants'

const people: CollectionConfig = {
	slug: 'people',
	custom: {
		formVariants: defineFormVariants('people', {
			defaultVariant: 'quick',
			variants: [
				{
					key: 'quick',
					steps: [
						{ key: 'identity', fields: ['firstName', 'lastName'] },
						{ key: 'check', Component: './DuplicateCheck#DuplicateCheck' },
					],
				},
			],
		}),
	},
	fields: [
		{ name: 'firstName', type: 'text' },
		{ name: 'lastName', type: 'text' },
	],
}

const tags: CollectionConfig = { slug: 'tags', fields: [{ name: 'title', type: 'text' }] }

describeForDb('formVariants loads', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [people, tags],
			db,
			plugin: formVariants({
				collections: {
					tags: { variants: [{ key: 'short', steps: [{ key: 'one', fields: ['title'] }] }] },
				},
			}),
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('registers the edit view on configured collections only', () => {
		const edit = booted.payload.collections.people?.config.admin.components?.views?.edit
		expect(edit && 'default' in edit ? edit.default : undefined).toEqual({ Component: VIEW_PATH })
		const tagsEdit = booted.payload.collections.tags?.config.admin.components?.views?.edit
		expect(tagsEdit && 'default' in tagsEdit ? tagsEdit.default : undefined).toEqual({
			Component: VIEW_PATH,
		})
		expect(booted.payload.collections.users?.config.admin.components?.views?.edit).toBeUndefined()
	})

	it('resolves both config places into one registry with native appended', () => {
		const resolved = getCollectionVariants(booted.payload.config, 'people')
		expect(resolved?.variants.map((variant) => variant.key)).toEqual(['quick', 'native'])
		expect(resolved?.variants[0]?.steps.map((step) => step.kind)).toEqual(['fields', 'component'])
		expect(
			getCollectionVariants(booted.payload.config, 'tags')?.variants.map((v) => v.key)
		).toEqual(['short', 'native'])
	})

	it('registers every component path so the import map finds it', () => {
		const dependencies = booted.payload.config.admin.dependencies ?? {}
		const paths = Object.values(dependencies).map((entry) => entry.path)
		expect(paths).toContain(VIEW_PATH)
		expect(paths).toContain('./DuplicateCheck#DuplicateCheck')
	})

	it('adds the evaluate endpoint', () => {
		expect(
			booted.payload.config.endpoints.some((endpoint) => endpoint.path === EVALUATE_PATH)
		).toBe(true)
	})

	it('keeps the resolved config server-only', () => {
		expect(booted.payload.config.custom).toHaveProperty('@10x-media/form-variants')
	})
})

describeForDb('formVariants config errors', { dbs: ['mongo'] }, (db) => {
	it('refuses a slug configured in both places', async () => {
		await expect(
			bootPayload({
				collections: [people],
				db,
				plugin: formVariants({
					collections: {
						people: { variants: [{ key: 'x', steps: [{ key: 's', fields: ['firstName'] }] }] },
					},
				}),
			})
		).rejects.toThrow(/both on the collection/)
	})

	it('refuses an unknown collection slug', async () => {
		await expect(
			bootPayload({
				collections: [tags],
				db,
				plugin: formVariants({
					collections: {
						ghosts: { variants: [{ key: 'x', steps: [{ key: 's', fields: ['title'] }] }] },
					} as never,
				}),
			})
		).rejects.toThrow(/Unknown collection slug "ghosts"/)
	})
})
