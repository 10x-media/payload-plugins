import { PRERENDER_READY_KEY, prerenderReadyTitle } from '../../../helpers/prerenderReady'

export const dynamic = 'force-dynamic'

/** A site path the speculation rules may name: a slash, then letters, digits, `-`, `_` and `/`. */
const SITE_PATH = /^\/[\w/-]*$/

/**
 * Asks the browser to prerender a thank-you page, `/thank-you` or the site path in `?to=`, the
 * way a checkout prerenders its confirmation. The tracker on the prerendered page must hold its
 * pageview until the visitor actually opens it, which the e2e lifecycle suite checks. This page's
 * title turns `Ready <path>` once the prerendered page's tracker booted (`PrerenderReady`), which
 * the suite reads from the DevTools target list without attaching to either page.
 */
export default async function PrerenderPage({
	searchParams,
}: {
	searchParams: Promise<{ to?: string | string[] }>
}) {
	const { to } = await searchParams
	const target = typeof to === 'string' && SITE_PATH.test(to) ? to : '/thank-you'
	const rules = JSON.stringify({ prerender: [{ source: 'list', urls: [target] }] })
	const ready = `addEventListener('storage', (event) => { if (event.key === ${JSON.stringify(PRERENDER_READY_KEY)} && event.newValue) { document.title = ${JSON.stringify(prerenderReadyTitle(''))} + event.newValue.split(' ')[0] } })`
	return (
		<main>
			<h1>Prerender</h1>
			<p>
				This page asks the browser to prerender <code>{target}</code>. Its pageview counts only once
				the link below opens it.
			</p>
			{/* A full navigation: a client-side one would never activate the prerendered page. */}
			<a href={target}>Continue</a>
			{/* Listening before the rules below start the prerender, so its signal is never missed. */}
			<script dangerouslySetInnerHTML={{ __html: ready }} />
			<script type="speculationrules" dangerouslySetInnerHTML={{ __html: rules }} />
		</main>
	)
}
