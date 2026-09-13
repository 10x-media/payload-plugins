import config from '@payload-config'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import { goalSlug } from '../../../../src/index'

export const dynamic = 'force-dynamic'

interface CtaBlock {
	id?: string
	blockType: 'cta'
	heading?: string
	label: string
	goal?: string
}

interface PageDoc {
	title?: string
	slug: string
	layout?: CtaBlock[]
}

export default async function DevPage({ params }: { params: Promise<{ slug: string }> }) {
	const { slug } = await params
	const payload = await getPayload({ config })
	const result = await payload.find({
		collection: 'pages' as never,
		where: { slug: { equals: slug } },
		limit: 1,
	})
	const page = result.docs[0] as PageDoc | undefined
	if (!page) {
		notFound()
	}
	return (
		<main>
			<p>
				<Link href="/">&larr; All pages</Link>
			</p>
			<h1>{page.title ?? page.slug}</h1>
			<p>
				This is the <code>/{page.slug}</code>{' '}
				<span>
					demo page. Loading it fired a pageview event; its numbers appear on this document&apos;s
					Analytics tab in the admin panel.
				</span>
			</p>
			{(page.layout ?? []).map((block, index) => (
				<section key={block.id ?? index}>
					<h2>{block.heading}</h2>
					<button data-analytics-goal={goalSlug(block.goal) ?? undefined} type="button">
						{block.label}
					</button>
				</section>
			))}
		</main>
	)
}
