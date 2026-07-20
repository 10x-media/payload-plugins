import config from '@payload-config'
import Link from 'next/link'
import { getPayload } from 'payload'
import { TrackPageview } from '../../components/TrackPageview'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
	const payload = await getPayload({ config })
	const pages = await payload.find({
		collection: 'pages' as never,
		limit: 20,
		sort: 'title',
	})
	return (
		<main>
			<TrackPageview />
			<h1>Analytics dev site</h1>
			<p>
				Every visit here posts a real pageview to <code>/api/analytics/ingest</code>. Browse a few
				pages, then open the admin dashboard or a page&apos;s Analytics tab to watch the numbers
				move.
			</p>
			<ul>
				{(pages.docs as Array<{ id: string; title?: string; slug: string }>).map((page) => (
					<li key={page.id}>
						<Link href={`/${page.slug}`}>{page.title ?? page.slug}</Link>
					</li>
				))}
			</ul>
			<p>
				<a href="/admin">Open the admin panel</a>
			</p>
		</main>
	)
}
