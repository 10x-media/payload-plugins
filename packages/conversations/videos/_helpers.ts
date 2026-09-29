// biome-ignore-all lint/plugin/noProcessEnv: screenshot rendering env boundary
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SceneSetup } from 'clipwright'
import type { APIRequestContext } from 'playwright'

export const ADMIN = { email: 'dev@10xmedia.de', password: 'password' }

/** The seeded website customer who owns the open ticket. */
export const CUSTOMER = { email: 'customer@example.com', password: 'password' }

export const BASE_URL = process.env.CONVERSATIONS_DEV_URL ?? 'http://localhost:3000'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/** Stills go straight into the docs app, one PNG per shot, committed with it. */
export const DOCS_IMAGES = path.resolve(dirname, '../../../apps/docs/public/images/conversations')

/**
 * Dark admin, signed in, admin shell compiled. Payload reads the
 * `payload-theme` cookie before `prefers-color-scheme`, so the cookie decides.
 */
export const openAdmin = async ({ context, page, request }: SceneSetup): Promise<void> => {
	await context.addCookies([{ name: 'payload-theme', url: BASE_URL, value: 'dark' }])
	// Next's dev indicator sits in the corner of every page; a still should not carry it.
	await context.addInitScript(() => {
		document.addEventListener('DOMContentLoaded', () => {
			const style = document.createElement('style')
			style.textContent = 'nextjs-portal { display: none !important; }'
			document.head.append(style)
		})
	})
	await request.post('/api/users/login', { data: ADMIN })
	await page.goto('/admin')
}

type Doc = { id: number | string }

/** The id of the first document of `collection` matching `field = value`, from the seeded dev data. */
export const findId = async (
	request: APIRequestContext,
	{ collection, field, value }: { collection: string; field: string; value: string }
): Promise<string> => {
	const res = await request.get(
		`/api/${collection}?depth=0&limit=1&where[${field}][equals]=${encodeURIComponent(value)}`
	)
	const { docs } = (await res.json()) as { docs: Doc[] }
	const doc = docs[0]
	if (!doc) throw new Error(`No ${collection} with ${field} = ${value}; is the dev app seeded?`)
	return String(doc.id)
}

/** React to a recent text message of a conversation, so the drawer shows reactions. */
export const react = async (
	request: APIRequestContext,
	{
		channel,
		emojis,
		instance,
		key,
	}: { channel: string; emojis: string[]; instance: string; key: string }
): Promise<void> => {
	const res = await request.get(
		`/api/conversations/${instance}/messages?key=${encodeURIComponent(key)}&channel=${channel}&limit=8`
	)
	const { messages } = (await res.json()) as { messages: Array<Doc & { type: string }> }
	const text = messages.filter((message) => message.type === 'text')
	const target = text.at(-2) ?? text.at(-1)
	if (!target) return
	for (const emoji of emojis) {
		await request.post(`/api/conversations/${instance}/reactions/add`, {
			data: { emoji, message: target.id },
		})
	}
}
