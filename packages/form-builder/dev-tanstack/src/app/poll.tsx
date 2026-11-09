import '@10x-media/form-builder/styles.css'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

import { DemoPoll } from '../../../dev/demo/DemoPoll'

/**
 * Server-only modules load inside the handler, which TanStack Start strips from the client bundle.
 * `strict: { output: false }`: Payload types JSON fields as `unknown`, which Start's serializable
 * check rejects; the documents are plain JSON read from the database.
 */
const load = createServerFn({ method: 'GET', strict: { output: false } }).handler(async () => {
	const [{ getPayload }, { loadPollDemo }, { default: config }] = await Promise.all([
		import('payload'),
		import('../../../dev/demo/data'),
		import('@payload-config'),
	])
	return loadPollDemo(await getPayload({ config }))
})

/** The Next dev app's `/poll` page (`dev/app/(frontend)/poll/page.tsx`), served by TanStack Start. */
export const Route = createFileRoute('/poll')({
	// The Next layout's `metadata.title` (dev/app/(frontend)/layout.tsx).
	head: () => ({ meta: [{ title: 'Form builder demo' }] }),
	component: PollPage,
	loader: () => load(),
})

function PollPage() {
	const data = Route.useLoaderData()
	if (!data) {
		return <p>Poll not seeded.</p>
	}
	return <DemoPoll form={data.form} />
}
