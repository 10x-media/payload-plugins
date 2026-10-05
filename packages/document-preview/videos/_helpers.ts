// biome-ignore-all lint/plugin/noProcessEnv: screenshot rendering env boundary
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SceneSetup } from 'clipwright'
import type { APIRequestContext } from 'playwright'

export const ADMIN = { email: 'dev@10xmedia.de', password: 'password' }

export const BASE_URL = process.env.DOCUMENT_PREVIEW_DEV_URL ?? 'http://localhost:3000'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/** Stills go straight into the docs app, committed with it. */
export const DOCS_IMAGES = path.resolve(
	dirname,
	'../../../apps/docs/public/images/document-preview'
)

/**
 * Dark admin, signed in, admin shell compiled. Payload reads the
 * `payload-theme` cookie before `prefers-color-scheme`, so the cookie decides.
 */
export const openAdmin = async ({ context, page, request }: SceneSetup): Promise<void> => {
	await context.addCookies([{ name: 'payload-theme', url: BASE_URL, value: 'dark' }])
	// Next's dev indicator sits in the corner of every page, and clipwright's cursor
	// picks a shape from whatever it last hovered; a still should carry neither.
	await context.addInitScript(() => {
		document.addEventListener('DOMContentLoaded', () => {
			const style = document.createElement('style')
			style.textContent = 'nextjs-portal, .clip-cursor { display: none !important; }'
			document.head.append(style)
		})
	})
	await request.post('/api/users/login', { data: ADMIN })
	await page.goto('/admin')
}

type Doc = { id: number | string }

/** The id of the first document of `collection` whose `field` equals `value`, from the seeded dev data. */
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
