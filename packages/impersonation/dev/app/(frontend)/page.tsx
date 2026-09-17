import { headers as nextHeaders } from 'next/headers'
import { getPayload } from 'payload'
import { DEV_CUSTOMER, DEV_PARTNER, DEV_SSO } from '../../helpers/seed'
import config from '../../payload.config'
import { SessionPanel } from './_components/SessionPanel'

export const dynamic = 'force-dynamic'

type ResolvedUser = { collection?: string; email?: string; id?: number | string } | null

const describe = (user: ResolvedUser) =>
	user ? `${user.collection} · ${user.email ?? user.id}` : 'nobody'

/**
 * Frontend fixture for later `getImpersonation`. Until the plugin issues sessions,
 * this page only shows who `payload.auth` resolves and offers the host logins.
 */
export default async function FrontendPage() {
	const payload = await getPayload({ config })
	const incoming = await nextHeaders()
	const { user } = await payload.auth({ headers: new Headers(incoming) })

	return (
		<main>
			<h1>Impersonation host</h1>
			<p>
				<code>req.user</code> is{' '}
				<strong data-testid="live-user">{describe(user as ResolvedUser)}</strong>.
			</p>
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
				<a data-testid="sso-login" href={`/api/sso-users/sso/callback?email=${DEV_SSO.email}`}>
					Sign in as {DEV_SSO.email} with fake SSO
				</a>
			</p>

			<p>
				<a href="/admin">Admin panel</a>
			</p>
		</main>
	)
}
