import { AUTH_SCOPE_HEADER } from '@10x-media/dual-session'
import { headers as nextHeaders } from 'next/headers'
import { getPayload } from 'payload'
import {
	DEMO_NOTE_TITLE,
	DEV_ADMIN,
	DEV_CUSTOMER,
	DEV_MEMBER,
	DEV_PARTNER,
} from '../../helpers/seed'
import config from '../../payload.config'
import { type ApiAction, ApiConsole } from './_components/ApiConsole'
import { SessionPanel } from './_components/SessionPanel'

export const dynamic = 'force-dynamic'

const ADMIN_COOKIE = 'payload-token'
const CUSTOMER_COOKIE = 'payload-customers-token'
const MEMBER_COOKIE = 'payload-users-token'
const PARTNER_COOKIE = 'partner-session'

type ResolvedUser = { collection?: string; email?: string; id?: number | string } | null

const describe = (user: ResolvedUser) =>
	user ? `${user.collection} · ${user.email ?? user.id}` : 'nobody'

const cell = { borderBottom: '1px solid #eee', padding: '0.35rem 0.5rem 0.35rem 0' }
const headCell = { ...cell, borderBottom: '1px solid #ccc', textAlign: 'left' as const }

/**
 * Renders who this browser is, once per scope, and offers writes that only the admin
 * collection is allowed to make. Before the plugin the two scopes could not disagree,
 * because every collection wrote the same cookie.
 */
export default async function WhoAmIPage() {
	const payload = await getPayload({ config })
	const incoming = await nextHeaders()

	const withScope = (scope: 'admin' | 'frontend') => {
		const headers = new Headers(incoming)
		headers.set(AUTH_SCOPE_HEADER, scope)
		return headers
	}

	const [live, asAdmin, asFrontend, noteResult, settings] = await Promise.all([
		payload.auth({ headers: new Headers(incoming) }),
		payload.auth({ headers: withScope('admin') }),
		payload.auth({ headers: withScope('frontend') }),
		payload.find({
			collection: 'notes',
			where: { title: { equals: DEMO_NOTE_TITLE } },
			limit: 1,
			depth: 0,
		}),
		payload.findGlobal({ slug: 'site-settings', depth: 0 }),
	])

	const note = noteResult.docs[0]
	const cookie = incoming.get('cookie') ?? ''
	const holds = (name: string) => new RegExp(`(^|;\\s*)${name}=`).test(cookie)

	const readActions: ApiAction[] = [
		{
			expectation: 'reads the shared cookie only',
			label: 'GET /api/users/me',
			method: 'GET',
			path: '/api/users/me',
		},
		{
			expectation: 'reads payload-customers-token',
			label: 'GET /api/customers/me',
			method: 'GET',
			path: '/api/customers/me',
		},
		{
			expectation: 'reads partner-session',
			label: 'GET /api/partners/me',
			method: 'GET',
			path: '/api/partners/me',
		},
		{
			expectation: 'collection endpoint declared before the plugin ran',
			label: 'GET /api/customers/ping',
			method: 'GET',
			path: '/api/customers/ping',
		},
		{
			expectation: 'rotates the isolated cookie, not the shared one',
			label: 'POST /api/customers/refresh-token',
			method: 'POST',
			path: '/api/customers/refresh-token',
		},
		{
			expectation: 'ends every customer session, admin session untouched',
			label: 'POST /api/customers/logout?allSessions',
			method: 'POST',
			path: '/api/customers/logout?allSessions=true',
		},
	]

	const scopeActions: ApiAction[] = [
		{
			expectation: 'still the customer: the proxy overwrites the header, never merges it',
			headers: { [AUTH_SCOPE_HEADER]: 'admin' },
			label: 'GET /me, forged admin scope',
			method: 'GET',
			path: '/api/customers/me',
		},
		{
			expectation: 'no Referer to attribute by, so the call falls back to admin scope',
			label: 'GET /me, no Referer',
			method: 'GET',
			path: '/api/customers/me',
			referrerPolicy: 'no-referrer',
		},
		{
			expectation: 'same fallback: the isolated cookie stands down, so an admin session wins here',
			label: 'PATCH note, no Referer',
			lookup: { incrementField: 'touchCount', path: '/api/notes?limit=1' },
			method: 'PATCH',
			path: '/api/notes',
			referrerPolicy: 'no-referrer',
		},
	]

	const writeActions: ApiAction[] = [
		{
			expectation: '403 without any session',
			label: 'GET /api/notes',
			method: 'GET',
			path: '/api/notes',
		},
		{
			expectation: 'looks the note up, then writes; 403 unless the admin session wins',
			label: 'PATCH note (lookup + write)',
			lookup: { incrementField: 'touchCount', path: '/api/notes?limit=1' },
			method: 'PATCH',
			path: '/api/notes',
		},
		{
			expectation: '403 without any session',
			label: 'GET /api/globals/site-settings',
			method: 'GET',
			path: '/api/globals/site-settings',
		},
		{
			body: { headline: `Touched at ${new Date().toISOString()}` },
			expectation: '403 unless the admin session wins this request',
			label: 'POST /api/globals/site-settings',
			method: 'POST',
			path: '/api/globals/site-settings',
		},
	]

	return (
		<main>
			<h1>Who am I?</h1>
			<p>
				This page is served under the website scope, so <code>req.user</code> here is{' '}
				<strong data-testid="live-user">{describe(live.user as ResolvedUser)}</strong>.
			</p>

			<table style={{ borderCollapse: 'collapse', marginBottom: '2rem', width: '100%' }}>
				<thead>
					<tr>
						<th style={headCell}>Scope</th>
						<th style={headCell}>Resolves to</th>
						<th style={headCell}>Cookies held</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td style={cell}>admin</td>
						<td data-testid="scope-admin" style={cell}>
							{describe(asAdmin.user as ResolvedUser)}
						</td>
						<td style={cell}>
							<code>{ADMIN_COOKIE}</code> {holds(ADMIN_COOKIE) ? '✅' : '❌'}
						</td>
					</tr>
					<tr>
						<td style={cell}>frontend</td>
						<td data-testid="scope-frontend" style={cell}>
							{describe(asFrontend.user as ResolvedUser)}
						</td>
						<td style={cell}>
							<code>{PARTNER_COOKIE}</code> {holds(PARTNER_COOKIE) ? '✅' : '❌'} ·{' '}
							<code>{CUSTOMER_COOKIE}</code> {holds(CUSTOMER_COOKIE) ? '✅' : '❌'} ·{' '}
							<code>{MEMBER_COOKIE}</code> {holds(MEMBER_COOKIE) ? '✅' : '❌'}
						</td>
					</tr>
				</tbody>
			</table>

			<h2>Sessions</h2>
			<div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: '1fr 1fr' }}>
				<SessionPanel
					collection="partners"
					cookieName={PARTNER_COOKIE}
					defaults={DEV_PARTNER}
					title="Partner (isolated, highest priority)"
				/>
				<SessionPanel
					collection="customers"
					cookieName={CUSTOMER_COOKIE}
					defaults={DEV_CUSTOMER}
					title="Customer (isolated)"
				/>
				<SessionPanel
					collection="users"
					cookieName={ADMIN_COOKIE}
					defaults={DEV_ADMIN}
					title="Admin (shared cookie)"
				/>
				<SessionPanel
					collection="users"
					cookieName={MEMBER_COOKIE}
					defaults={DEV_MEMBER}
					title="Member (same collection, isolated)"
				/>
			</div>

			<h2>One collection, two sessions</h2>
			<p>
				The two panels above post to the same <code>/api/users/login</code>. Which cookie comes back
				is decided by the <code>isolate</code> predicate reading the document's <code>roles</code>,
				not by which collection was asked: staff land on <code>{ADMIN_COOKIE}</code>, byte for byte
				what Payload would have written without this plugin, and everyone else on{' '}
				<code>{MEMBER_COOKIE}</code>. So the admin and the member can be signed in together in this
				browser, out of one collection.
			</p>
			<p>
				What the plugin does <em>not</em> do is decide who may do what. With the boundary inside a
				collection, <code>req.user.collection</code> is <code>users</code> for both, so the access
				functions on <code>notes</code> ask about the role instead. See <code>adminOnly</code> in{' '}
				<code>dev/collections.ts</code>.
			</p>

			<h2>Custom SSO</h2>
			<p>
				<code>customers</code> also carries a hand-rolled auth strategy, the shape a Google or SAML
				login takes when you write it yourself rather than install a plugin. The strategy needs no
				changes to work here: isolated collections keep their declared strategies ahead of the
				cookie one, so yours still gets first refusal.
			</p>
			<p>
				What does change is the callback. A stock one ends with <code>generatePayloadCookie</code>,
				which writes <code>{ADMIN_COOKIE}</code> and wipes the admin session it finds there. This
				one calls <code>generateIsolatedAuthCookie</code> instead, see <code>dev/sso.ts</code>. Log
				in as the admin first, then use the link: the admin session survives.
			</p>
			<p>
				<a data-testid="sso-login" href={`/api/customers/sso/callback?email=${DEV_CUSTOMER.email}`}>
					Sign in as {DEV_CUSTOMER.email} with fake SSO
				</a>
			</p>

			<h2>Reads</h2>
			<ApiConsole actions={readActions} title="Each collection reports its own cookie" />

			<h2>Writes</h2>
			<p>
				<code>notes</code> and <code>site-settings</code> allow reads to any session but updates
				only to <code>users</code>. What the plugin decides is <em>which</em> session a request
				resolves to; access control then does its usual job on that answer. The shared admin cookie
				is never gated by scope (only isolated cookies are), so an admin-only browser can still
				write from the website, while adding a frontend session takes that ability away.
			</p>
			<table style={{ borderCollapse: 'collapse', marginBottom: '1rem', width: '100%' }}>
				<thead>
					<tr>
						<th style={headCell}>Cookies held</th>
						<th style={headCell}>Frontend request resolves to</th>
						<th style={headCell}>PATCH note</th>
					</tr>
				</thead>
				<tbody>
					{[
						['none', 'nobody', '403 (read is refused too)'],
						['customer', 'customer', '403'],
						['partner + customer', 'partner (listed first)', '403'],
						['admin', 'admin, via the untouched shared cookie', '200'],
						['admin + customer', 'customer, which outranks nothing but runs first', '403'],
						['member', 'member, same collection as the admin, no staff role', '403'],
						['admin + member', 'member: the isolated cookie wins a frontend request', '403'],
					].map(([cookies, resolves, verdict]) => (
						<tr key={cookies}>
							<td style={cell}>{cookies}</td>
							<td style={cell}>{resolves}</td>
							<td style={cell}>{verdict}</td>
						</tr>
					))}
				</tbody>
			</table>
			<ApiConsole actions={writeActions} title="Admin-only updates" />

			<h2>Scope edge cases</h2>
			<p>
				The proxy resolves a scope per request and always overwrites{' '}
				<code>{AUTH_SCOPE_HEADER}</code>, so a client cannot pick its own. An API call it cannot
				attribute falls back to <code>admin</code>, which can only ever mean "the frontend cookie is
				not honoured", never a wrongly authenticated request.
			</p>
			<ApiConsole actions={scopeActions} title="What a client can and cannot influence" />

			<p>
				Note: <code>{note?.title}</code> · touchCount <strong>{note?.touchCount ?? 0}</strong> ·
				last touched by <code>{note?.lastTouchedBy ?? 'nobody'}</code>
				<br />
				Global headline: <code>{settings.headline ?? 'none'}</code> · last touched by{' '}
				<code>{settings.lastTouchedBy ?? 'nobody'}</code>
			</p>

			<h2>Try this</h2>
			<ol>
				<li>
					Log in as the customer, then open <a href="/admin">/admin</a>: the admin panel still shows
					its own session (or the login form), instead of bouncing you to{' '}
					<code>/admin/unauthorized</code>.
				</li>
				<li>
					Log in as both the partner and the customer: the frontend scope resolves to the partner,
					because it is listed first in the plugin's <code>collections</code>.
				</li>
				<li>
					Log in as the admin, then as the member: both are <code>users</code>, both sessions are
					live, the admin panel still belongs to the admin, and the website resolves to the member.
				</li>
				<li>
					Log in as the admin only, then run <code>PATCH /api/notes/:id</code>: it succeeds, because
					no isolated cookie is present and the shared cookie still authenticates. Add a customer
					login and it starts failing with 403.
				</li>
			</ol>
		</main>
	)
}
