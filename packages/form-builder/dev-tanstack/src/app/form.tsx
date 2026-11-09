import '@10x-media/form-builder/styles.css'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

import { DemoForm } from '../../../dev/demo/DemoForm'

/**
 * Server-only modules load inside the handler, which TanStack Start strips from the client bundle.
 * `strict: { output: false }`: Payload types JSON fields as `unknown`, which Start's serializable
 * check rejects; the documents are plain JSON read from the database.
 */
const load = createServerFn({ method: 'GET', strict: { output: false } }).handler(async () => {
	const [{ getPayload }, { loadFormDemo }, { default: config }] = await Promise.all([
		import('payload'),
		import('../../../dev/demo/data'),
		import('@payload-config'),
	])
	return loadFormDemo(await getPayload({ config }))
})

/** The Next dev app's `/form` page (`dev/app/(frontend)/form/page.tsx`), served by TanStack Start. */
export const Route = createFileRoute('/form')({
	// The Next layout's `metadata.title` (dev/app/(frontend)/layout.tsx).
	head: () => ({ meta: [{ title: 'Form builder demo' }] }),
	component: FormPage,
	loader: () => load(),
})

function FormPage() {
	const data = Route.useLoaderData()
	if (!data) {
		return <p>Demo form not seeded.</p>
	}
	return <DemoForm form={data.form} consentStatements={data.consentStatements} />
}
