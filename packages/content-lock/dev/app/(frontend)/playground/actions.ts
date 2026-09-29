'use server'

import config from '@payload-config'
import { headers } from 'next/headers'
import { type CollectionSlug, type GlobalSlug, getPayload } from 'payload'

import { sampleData } from './sample'

export type WriteResult =
	| { ok: true; id?: number | string }
	| { ok: false; name: string; status?: number; message: string; data?: unknown }

/**
 * A Local API write from the server, as system code would do it. With
 * `overrideAccess: false` it runs as the signed-in admin, so collection access
 * applies; with `true` access is skipped, which the lock must not care about.
 */
export async function localWrite(input: {
	kind: 'collection' | 'global'
	slug: string
	overrideAccess: boolean
}): Promise<WriteResult> {
	const payload = await getPayload({ config })
	const { user } = input.overrideAccess
		? { user: null }
		: await payload.auth({ headers: await headers() })
	try {
		if (input.kind === 'global') {
			await payload.updateGlobal({
				slug: input.slug as GlobalSlug,
				data: sampleData(input.kind, input.slug),
				overrideAccess: input.overrideAccess,
				user,
			})
			return { ok: true }
		}
		const doc = await payload.create({
			collection: input.slug as CollectionSlug,
			data: sampleData(input.kind, input.slug),
			overrideAccess: input.overrideAccess,
			user,
		})
		return { ok: true, id: doc.id }
	} catch (error) {
		const failure = error as { name?: string; status?: number; message?: string; data?: unknown }
		return {
			ok: false,
			name: failure.name ?? 'Error',
			status: failure.status,
			message: failure.message ?? String(error),
			data: failure.data,
		}
	}
}

export type PlaygroundTask = 'playgroundWrite' | 'playgroundWriteDeferred' | 'playgroundBatch'

/** Queue a playground job that writes into `slug`; the dev worker picks it up. */
export async function queueJob(input: { task: PlaygroundTask; slug: string }): Promise<void> {
	const payload = await getPayload({ config })
	await payload.jobs.queue({ input: { slug: input.slug }, task: input.task } as Parameters<
		typeof payload.jobs.queue
	>[0])
}
