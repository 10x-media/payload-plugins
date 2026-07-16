import config from '@payload-config'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import { TrackPageview } from '../../../components/TrackPageview'

export const dynamic = 'force-dynamic'

export default async function DevPage({ params }: { params: Promise<{ slug: string }> }) {
	const { slug } = await params
	const payload = await getPayload({ config })
	const result = await payload.find({
		collection: 'pages' as never,
		where: { slug: { equals: slug } },
		limit: 1,
	})
	const page = result.docs[0] as { title?: string; slug: string } | undefined
	if (!page) {
		notFound()
	}
	return (
		<main>
			<TrackPageview />
			<p>
				<Link href="/">&larr; All pages</Link>
			</p>
			<h1>{page.title ?? page.slug}</h1>
			<p>
				This is the <code>/{page.slug}</code> demo page. Loading it fired a pageview event; its
				numbers appear on this document&apos;s Analytics tab in the admin panel.
			</p>
		</main>
	)
}
