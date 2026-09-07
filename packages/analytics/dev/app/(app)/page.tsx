import config from '@payload-config'
import Link from 'next/link'
import { getPayload } from 'payload'
import { pagePath } from '../../config/shared'

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
			<h1>Analytics dev site</h1>
			<p>
				The tracker booted in the layout posts a real pageview to <code>/api/analytics/ingest</code>{' '}
				on every navigation. Browse a few pages, then open the admin dashboard or a page&apos;s
				Analytics tab to watch the numbers move.
			</p>
			<p>
				<button data-analytics-goal="book-demo" type="button">
					Book a demo
				</button>{' '}
				fires the <code>book-demo</code> goal; <Link href="/thank-you">/thank-you</Link> completes a
				path goal just by being visited.
			</p>
			<ul>
				{(pages.docs as Array<{ id: string; title?: string; slug: string }>).map((page) => (
					<li key={page.id}>
						<Link href={pagePath(page) ?? '/'}>{page.title ?? page.slug}</Link>
					</li>
				))}
			</ul>
			<p>
				<a href="/admin">Open the admin panel</a>
			</p>
		</main>
	)
}
