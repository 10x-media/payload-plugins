import { headers } from 'next/headers'
import { getPayload } from 'payload'

import { DemoPage } from '../../demo/DemoPage'
import { loadDemoData } from '../../demo/data'
import config from '../../payload.config'
import { NextRefresh } from './_components/NextRefresh'

export const dynamic = 'force-dynamic'

/** The demo page on Next.js; `dev-tanstack/src/app/index.tsx` serves the same one. */
export default async function WhoAmIPage() {
	const payload = await getPayload({ config })
	const data = await loadDemoData({ headers: new Headers(await headers()), payload })

	return (
		<NextRefresh>
			<DemoPage data={data} />
		</NextRefresh>
	)
}
