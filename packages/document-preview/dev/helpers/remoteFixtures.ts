import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Payload } from 'payload'

/**
 * Real-world files too large or not ours to commit: office documents from
 * extend's docs, CC0 video and audio from MDN's examples, a CC0 glTF model from
 * Khronos' samples and an MIT STL from three.js' examples.
 */
const REMOTE_FIXTURES = [
	'https://www.extend.ai/ui/samples/demo.docx',
	'https://www.extend.ai/ui/samples/demo.pptx',
	'https://www.extend.ai/ui/samples/crazy-chart-zoo.xlsx',
	'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
	'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm',
	'https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3',
	'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Avocado/glTF-Binary/Avocado.glb',
	'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/stl/binary/colored.stl',
]

const cacheDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.seed-cache')

const load = async (url: string): Promise<{ data: Buffer; name: string }> => {
	const name = path.basename(new URL(url).pathname)
	const cached = path.join(cacheDir, name)
	try {
		return { data: await readFile(cached), name }
	} catch {
		const response = await fetch(url)
		if (!response.ok) {
			throw new Error(`${response.status} ${response.statusText}`)
		}
		const data = Buffer.from(await response.arrayBuffer())
		await mkdir(cacheDir, { recursive: true })
		await writeFile(cached, data)
		return { data, name }
	}
}

/**
 * The remote fixtures, downloaded once into the gitignored `dev/.seed-cache`
 * and read from there afterwards. A fixture that cannot be fetched (offline,
 * moved upstream) is skipped with a warning so the rest of the seed still runs.
 */
export const loadRemoteFixtures = async (
	payload: Payload
): Promise<Array<{ data: Buffer; name: string }>> => {
	const results = await Promise.allSettled(REMOTE_FIXTURES.map(load))
	return results.flatMap((result, index) => {
		if (result.status === 'fulfilled') {
			return [result.value]
		}
		payload.logger.warn(`Skipped seed fixture ${REMOTE_FIXTURES[index]}: ${String(result.reason)}`)
		return []
	})
}
