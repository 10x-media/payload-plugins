import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'

import { DemoPage } from '../../../dev/demo/DemoPage'
import { RefreshProvider } from '../../../dev/demo/refresh'

/**
 * Loads the demo's data from the request Payload's adapter also reads, so it sees the scope the
 * auth-scope middleware stamped (`src/start.ts`). Server-only modules load inside the handler,
 * which TanStack Start strips from the client bundle.
 */
const loadDemo = createServerFn({ method: 'GET' }).handler(async () => {
	const [{ getPayload }, { loadDemoData }, { default: config }] = await Promise.all([
		import('payload'),
		import('../../../dev/demo/data'),
		import('@payload-config'),
	])

	return loadDemoData({
		headers: new Headers(getRequest().headers),
		payload: await getPayload({ config }),
	})
})

/** The Next dev app's demo page (`dev/app/(frontend)/page.tsx`), served by TanStack Start. */
export const Route = createFileRoute('/')({
	component: FrontendPage,
	loader: () => loadDemo(),
})

function FrontendPage() {
	const router = useRouter()

	return (
		<RefreshProvider refresh={() => void router.invalidate()}>
			<DemoPage data={Route.useLoaderData()} />
		</RefreshProvider>
	)
}
