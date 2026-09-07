import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default function ThankYouPage() {
	return (
		<main>
			<p>
				<Link href="/">&larr; All pages</Link>
			</p>
			<h1>Thanks</h1>
			<p>
				Loading this page completes the <code>thank-you</code>{' '}
				<span>
					goal: its pageview matches the goal&apos;s path pattern, so no markup or tracking call is
					involved.
				</span>
			</p>
		</main>
	)
}
