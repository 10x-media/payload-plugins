import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig } from 'payload'
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'

import { contentLock, isContentLocked } from '../../src/index'
import { forgetWindows, SNAPSHOT_KEY } from '../../src/state/store'

const LOCKS = 'content-locks'

const posts: CollectionConfig = { slug: 'posts', fields: [{ name: 'title', type: 'text' }] }

/**
 * With localization the window messages are localized, so Payload 4 keeps
 * `_status` per locale. A window must lock whatever locale it was published in.
 */
describeForDb('content-lock with localization', {}, (db) => {
	let booted: BootedPayload

	const payload = () => booted.payload

	/** Read the lock state from the collection, not from what this process holds. */
	const lockedFresh = async () => {
		forgetWindows(payload())
		await payload().kv.delete(SNAPSHOT_KEY)
		return isContentLocked(payload(), { collection: 'posts' })
	}

	const statusInAllLocales = async (id: number | string) => {
		const doc = await payload().findByID({
			collection: LOCKS,
			id,
			locale: 'all',
			overrideAccess: true,
		})
		return (doc as { _status?: unknown })._status
	}

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			collections: [posts],
			plugin: contentLock({}),
			configOverrides: { localization: { locales: ['en', 'de'], defaultLocale: 'en' } },
		})
	})

	afterEach(async () => {
		await payload().delete({
			collection: LOCKS,
			where: { id: { exists: true } },
			overrideAccess: true,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('publishes a window created through the Local API in every locale', async () => {
		const window = await payload().create({
			collection: LOCKS,
			data: { title: 'Upgrade' },
			overrideAccess: true,
		})
		expect(await statusInAllLocales(window.id)).toEqual({ de: 'published', en: 'published' })
		expect(await lockedFresh()).toBe(true)
	})

	it('locks when published in a locale other than the default', async () => {
		const window = await payload().create({
			collection: LOCKS,
			data: { title: 'Upgrade' },
			draft: true,
			overrideAccess: true,
		})
		expect(await lockedFresh()).toBe(false)
		await payload().update({
			collection: LOCKS,
			data: { _status: 'published' },
			id: window.id,
			locale: 'de',
			overrideAccess: true,
		})
		expect(await statusInAllLocales(window.id)).toEqual({ de: 'published', en: 'published' })
		expect(await lockedFresh()).toBe(true)
	})

	it('keeps a published window locking through a draft save in one locale', async () => {
		const window = await payload().create({
			collection: LOCKS,
			data: { title: 'Upgrade' },
			overrideAccess: true,
		})
		await payload().update({
			collection: LOCKS,
			data: { title: 'Upgrade, revised' },
			draft: true,
			id: window.id,
			locale: 'de',
			overrideAccess: true,
		})
		expect(await lockedFresh()).toBe(true)
	})
})
