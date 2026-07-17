// biome-ignore-all lint/plugin/noProcessEnv: Next.js public env for the proxy demo page
import { providerScriptSnippet } from '@10x-media/analytics/next'

export default function Home() {
	const token = process.env.NEXT_PUBLIC_POSTHOG_KEY
	const posthog = token ? providerScriptSnippet({ provider: 'posthog', token, region: 'eu' }) : null

	return (
		<main style={{ fontFamily: 'system-ui', padding: '2rem', lineHeight: 1.5 }}>
			<h1>PostHog proxy test</h1>
			<p>
				Open DevTools → Network. Filter for <code>/ph</code>. You should see{' '}
				<code>/ph/static/array.js</code> and capture POSTs to <code>/ph/e/</code> (or similar) on{' '}
				<strong>this origin</strong>, not <code>*.posthog.com</code>.
			</p>
			{posthog ? (
				<div dangerouslySetInnerHTML={{ __html: posthog }} />
			) : (
				<p style={{ color: 'crimson' }}>
					Missing <code>NEXT_PUBLIC_POSTHOG_KEY</code> in <code>dev/.env.local</code>.
				</p>
			)}
			<p style={{ fontSize: '0.875rem', color: '#666' }}>
				Confirm in PostHog → Activity / Live events for project 178249 (EU).
			</p>
		</main>
	)
}
