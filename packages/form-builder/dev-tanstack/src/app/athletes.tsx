import '@10x-media/form-builder/styles.css'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

import { AthletePoll } from '../../../dev/demo/AthletePoll'

/**
 * Server-only modules load inside the handler, which TanStack Start strips from the client bundle.
 * `strict: { output: false }`: Payload types JSON fields as `unknown`, which Start's serializable
 * check rejects; the documents are plain JSON read from the database.
 */
const load = createServerFn({ method: 'GET', strict: { output: false } }).handler(async () => {
	const [{ getPayload }, { loadAthletesDemo }, { default: config }] = await Promise.all([
		import('payload'),
		import('../../../dev/demo/data'),
		import('@payload-config'),
	])
	return loadAthletesDemo(await getPayload({ config }))
})

/** The Next dev app's `/athletes` page (`dev/app/(frontend)/athletes/page.tsx`), served by TanStack Start. */
export const Route = createFileRoute('/athletes')({
	// The Next layout's `metadata.title` (dev/app/(frontend)/layout.tsx).
	head: () => ({ meta: [{ title: 'Form builder demo' }] }),
	component: AthletesPage,
	loader: () => load(),
})

function AthletesPage() {
	const data = Route.useLoaderData()
	if (!data) {
		return <p>Poll not seeded.</p>
	}
	return <AthletePoll form={data.form} pollOptions={data.pollOptions} />
}
