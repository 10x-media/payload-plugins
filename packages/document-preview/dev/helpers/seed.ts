import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Payload } from 'payload'

import { generateTables } from './generateTables'
import { loadRemoteFixtures } from './remoteFixtures'

const DEV_EMAIL = 'dev@10xmedia.de'
const DEV_PASSWORD = 'password'

const seedFilesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../seed-files')

/** Mimes for the fixtures, set explicitly so the dev data does not depend on sniffing. */
const MIME_BY_EXTENSION: Record<string, string> = {
	csv: 'text/csv',
	docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	glb: 'model/gltf-binary',
	json: 'application/json',
	md: 'text/markdown',
	mp3: 'audio/mpeg',
	mp4: 'video/mp4',
	pdf: 'application/pdf',
	png: 'image/png',
	pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
	stl: 'model/stl',
	svg: 'image/svg+xml',
	tsv: 'text/tab-separated-values',
	wav: 'audio/wav',
	webm: 'video/webm',
	xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	yaml: 'application/yaml',
	zip: 'application/zip',
}

/**
 * Seed the dev Payload app: an admin user to log in with, one media document
 * per fixture in `dev/seed-files` (every built-in viewer, plus an unsupported
 * type for the info card), extend's sample office documents (downloaded once
 * and cached), and generated CSV/TSV tables for the virtualized table, too large
 * to commit. Idempotent.
 */
export const seedDev = async (payload: Payload): Promise<void> => {
	const userCount = await payload.count({ collection: 'users' })
	if (userCount.totalDocs === 0) {
		await payload.create({
			collection: 'users',
			data: { email: DEV_EMAIL, password: DEV_PASSWORD },
		})
		payload.logger.info(`Seeded dev admin: ${DEV_EMAIL} / ${DEV_PASSWORD}`)
	}

	const mediaCount = await payload.count({ collection: 'media' })
	if (mediaCount.totalDocs > 0) {
		return
	}
	const fixtures = await Promise.all(
		(await readdir(seedFilesDir)).map(async (name) => ({
			data: await readFile(path.join(seedFilesDir, name)),
			name,
		}))
	)
	const remote = await loadRemoteFixtures(payload)
	const tables = generateTables().map(({ name, text }) => ({ data: Buffer.from(text), name }))
	for (const { data, name } of [...fixtures, ...remote, ...tables]) {
		const extension = name.slice(name.lastIndexOf('.') + 1)
		await payload.create({
			collection: 'media',
			data: { alt: name },
			file: {
				data,
				mimetype: MIME_BY_EXTENSION[extension] ?? 'application/octet-stream',
				name,
				size: data.byteLength,
			},
		})
	}
	payload.logger.info('Seeded dev media fixtures')

	const media = await payload.find({ collection: 'media', depth: 0, limit: 100, pagination: false })
	const idOf = (name: string) => media.docs.find((doc) => doc.filename === name)?.id
	const ids = (names: string[]) =>
		names.map(idOf).filter((id): id is NonNullable<typeof id> => id !== undefined)
	await payload.create({
		collection: 'posts',
		data: {
			attachments: ids([
				'sample.pdf',
				'demo.docx',
				'crazy-chart-zoo.xlsx',
				'demo.pptx',
				'tiny.csv',
				'notes.md',
				'sample.json',
				'config.yaml',
				't-rex-roar.mp3',
				'flower.mp4',
				'archive.zip',
				'sample.png',
				'Avocado.glb',
				'colored.stl',
			]),
			cover: idOf('sample.pdf'),
			title: 'Every file type',
		},
	})
	await payload.create({
		collection: 'posts',
		data: { cover: idOf('sample.png'), title: 'Image cover' },
	})
	payload.logger.info('Seeded dev posts')
}
