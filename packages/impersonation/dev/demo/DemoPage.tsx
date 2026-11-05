import { ImpersonationFrontendBannerView } from '@10x-media/impersonation/client'

import { DEV_CUSTOMER, DEV_PARTNER, DEV_SSO } from '../helpers/seed'
import type { DemoData } from './data'
import { SessionPanel } from './SessionPanel'

/**
 * The website demo page, framework free: `dev/app/(frontend)/page.tsx` renders it on Next.js and
 * `dev-tanstack/src/app/index.tsx` on TanStack Start, each from `loadDemoData`.
 */
export const DemoPage = ({ data }: { data: DemoData }) => (
	<div
		style={{
			fontFamily: 'system-ui, sans-serif',
			lineHeight: 1.5,
			maxWidth: '40rem',
			padding: '2rem',
		}}
	>
		{/* TanStack Start's root layout is shared boilerplate, so the page resets the body margin. */}
		<style>{'body { margin: 0 }'}</style>
		<ImpersonationFrontendBannerView banner={data.banner} />
		<main>
			<h1>Impersonation host</h1>
			<p>
				<code>req.user</code> is <strong>{data.user}</strong>.
			</p>
			<p className="dev-impersonation-status">{data.status}</p>
			<p>
				Customer login writes the shared cookie (swap). Partner login writes an isolated cookie
				(parallel). SSO has no password; it uses the callback below.
			</p>

			<div style={{ display: 'grid', gap: '1rem' }}>
				<SessionPanel
					collection="customers"
					cookieName="payload-token"
					defaults={DEV_CUSTOMER}
					title="Customer (local auth, swap)"
				/>
				<SessionPanel
					collection="partners"
					cookieName="payload-partners-token"
					defaults={DEV_PARTNER}
					title="Partner (isolated, parallel)"
				/>
			</div>

			<p>
				<a href={`/api/sso-users/sso/callback?email=${DEV_SSO.email}`}>
					Sign in as {DEV_SSO.email} with fake SSO
				</a>
			</p>

			<p>
				<a href="/admin">Admin panel</a>
			</p>
		</main>
	</div>
)
