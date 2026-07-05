import Link from 'next/link'
import { LegacyDocsRedirect } from '@/components/legacy-docs-redirect'

export default function NotFound() {
	return (
		<main style={{ padding: '4rem 2rem', maxWidth: 720, margin: '0 auto' }}>
			<LegacyDocsRedirect />
			<h1>Page not found</h1>
			<p>
				<Link href="/">Back to the docs</Link>
			</p>
		</main>
	)
}
