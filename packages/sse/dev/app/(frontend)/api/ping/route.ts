import { getSSE, scopedTopic } from '@10x-media/sse'
import config from '@payload-config'
import { cookies, headers } from 'next/headers'
import { getPayload } from 'payload'

export async function POST() {
	const payload = await getPayload({ config })
	const { user } = await payload.auth({ headers: await headers() })
	if (!user) {
		return Response.json({ error: 'unauthorized' }, { status: 401 })
	}

	const tenant = (await cookies()).get('payload-tenant')?.value
	if (!tenant) {
		return Response.json({ error: 'set payload-tenant cookie first' }, { status: 400 })
	}

	const topic = scopedTopic(tenant, 'pages')
	getSSE(payload).emit({
		id: crypto.randomUUID(),
		topic,
		event: 'update',
		collection: 'pages',
		timestamp: Date.now(),
		operation: 'update',
		scope: tenant,
		data: { ping: true },
	})
	return Response.json({ ok: true, topic })
}
