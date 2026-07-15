import { providerScriptSnippet } from '@10x-media/analytics/next'

export default function Home() {
	const plausible = providerScriptSnippet({ provider: 'plausible', domain: 'example.com' })
	const umami = providerScriptSnippet({ provider: 'umami', websiteId: 'demo-website-id' })
	const posthog = providerScriptSnippet({ provider: 'posthog', token: 'phc_demo', region: 'eu' })
	return (
		<main style={{ fontFamily: 'system-ui', padding: '2rem', lineHeight: 1.5 }}>
			<h1>Tracker proxy spike</h1>
			<p>
				Open DevTools → Network. Requests below hit this origin (<code>/pa</code>, <code>/um</code>,{' '}
				<code>/ph</code>), never the vendor domains.
			</p>
			<div dangerouslySetInnerHTML={{ __html: plausible }} />
			<div dangerouslySetInnerHTML={{ __html: umami }} />
			<div dangerouslySetInnerHTML={{ __html: posthog }} />
		</main>
	)
}
