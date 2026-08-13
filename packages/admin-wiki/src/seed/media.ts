import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { CollectionSlug, Payload } from 'payload'

import { asLocale } from '../shared/resolveLocale'
import { splitLocalized } from './localized'
import type { WikiSeedMediaDef, WikiSeedResult } from './types'

const MIME_BY_EXTENSION: Record<string, string> = {
	avif: 'image/avif',
	gif: 'image/gif',
	jpeg: 'image/jpeg',
	jpg: 'image/jpeg',
	mov: 'video/quicktime',
	mp4: 'video/mp4',
	png: 'image/png',
	svg: 'image/svg+xml',
	webm: 'video/webm',
	webp: 'image/webp',
}

const mimeFor = (name: string, contentType?: null | string): string => {
	if (contentType?.includes('/') && !contentType.startsWith('text/html')) {
		return contentType.split(';')[0] ?? 'application/octet-stream'
	}
	const extension = name.split('.').pop()?.toLowerCase() ?? ''
	return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream'
}

type LoadedFile = {
	data: Buffer
	mimetype: string
	name: string
}

const loadMediaFile = async (def: WikiSeedMediaDef): Promise<LoadedFile> => {
	if (def.file) {
		const data = await readFile(def.file).catch((error: unknown) => {
			throw new Error(
				`@10x-media/admin-wiki seed: cannot read media file "${def.file}" for key "${def.key}"`,
				{ cause: error }
			)
		})
		const name = basename(def.file)
		return { data, mimetype: mimeFor(name), name }
	}
	if (def.url) {
		const response = await fetch(def.url).catch((error: unknown) => {
			throw new Error(
				`@10x-media/admin-wiki seed: network failure fetching "${def.url}" for key "${def.key}"`,
				{ cause: error }
			)
		})
		if (!response.ok) {
			throw new Error(
				`@10x-media/admin-wiki seed: fetching "${def.url}" for key "${def.key}" returned ${response.status}`
			)
		}
		const data = Buffer.from(await response.arrayBuffer())
		const name = basename(new URL(def.url).pathname) || def.key
		return { data, mimetype: mimeFor(name, response.headers.get('content-type')), name }
	}
	throw new Error(`@10x-media/admin-wiki seed: media "${def.key}" declares neither file nor url`)
}

type EnsureSeedMediaArgs = {
	defaultLocale: string | undefined
	defs: WikiSeedMediaDef[]
	mediaSlug: string
	payload: Payload
}

/**
 * Upload every declared media item into the wiki media collection, keyed for
 * placeholder resolution. Idempotent per key: an existing document with the
 * same original filename is reused (alt text refreshed) instead of duplicated.
 */
export const ensureSeedMedia = async ({
	defaultLocale,
	defs,
	mediaSlug,
	payload,
}: EnsureSeedMediaArgs): Promise<WikiSeedResult['media']> => {
	const media: WikiSeedResult['media'] = {}
	for (const def of defs) {
		const alt = splitLocalized(def.alt, defaultLocale, `media.${def.key}.alt`)
		const file = await loadMediaFile(def)
		const existing = await payload.find({
			collection: mediaSlug as CollectionSlug,
			depth: 0,
			limit: 1,
			pagination: false,
			where: { filename: { equals: file.name } },
		})
		let id: number | string
		if (existing.docs[0]) {
			id = existing.docs[0].id as number | string
			if (alt.base !== undefined) {
				await payload.update({
					collection: mediaSlug as CollectionSlug,
					data: { alt: alt.base },
					id,
				})
			}
		} else {
			const created = await payload.create({
				collection: mediaSlug as CollectionSlug,
				data: { alt: alt.base ?? def.key },
				file: { ...file, size: file.data.length },
			})
			id = created.id as number | string
		}
		for (const [locale, value] of Object.entries(alt.rest)) {
			await payload.update({
				collection: mediaSlug as CollectionSlug,
				data: { alt: value },
				id,
				locale: asLocale(locale),
			})
		}
		media[def.key] = { id, relationTo: mediaSlug }
	}
	return media
}
