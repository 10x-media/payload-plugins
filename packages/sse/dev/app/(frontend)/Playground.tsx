'use client'

import {
	useDocumentConflict,
	useDocumentPresence,
	usePayloadDocument,
	usePayloadList,
	usePayloadSubscription,
} from '@10x-media/sse/client'
import { type CSSProperties, type FormEvent, useCallback, useEffect, useState } from 'react'

const TENANT_COOKIE = 'payload-tenant'
const CREDENTIALS = [
	{ email: 'dev@10xmedia.de', password: 'password', label: 'Admin, all tenants' },
	{ email: 'viewer@10xmedia.de', password: 'password', label: 'Viewer, Acme' },
	{ email: 'globex@10xmedia.de', password: 'password', label: 'Globex editor' },
] as const

type AuthUser = { id: string; email?: string; name?: string }
type TenantDoc = { id: string; name?: string }
type PageDoc = { id: string; title?: string; status?: string }

const readCookie = (name: string): string => {
	if (typeof document === 'undefined') return ''
	const prefix = `${name}=`
	const row = document.cookie.split('; ').find((part) => part.startsWith(prefix))
	return row ? decodeURIComponent(row.slice(prefix.length)) : ''
}

const setTenantCookie = (id: string): void => {
	// biome-ignore lint/suspicious/noDocumentCookie: payload-tenant is the plugin-multi-tenant selector
	document.cookie = `${TENANT_COOKIE}=${encodeURIComponent(id)}; path=/`
}

const jsonPre = (value: unknown): string => JSON.stringify(value, null, 2)

export const Playground = () => {
	const [user, setUser] = useState<AuthUser | null>(null)
	const [authChecked, setAuthChecked] = useState(false)
	const [email, setEmail] = useState<string>(CREDENTIALS[0].email)
	const [password, setPassword] = useState<string>(CREDENTIALS[0].password)
	const [error, setError] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)

	useEffect(() => {
		void fetch('/api/users/me', { credentials: 'include' })
			.then(async (res) => {
				if (!res.ok) return null
				const body = (await res.json()) as { user?: AuthUser }
				return body.user ?? null
			})
			.then((next) => {
				if (next?.id) setUser({ id: String(next.id), email: next.email, name: next.name })
			})
			.catch(() => {})
			.finally(() => setAuthChecked(true))
	}, [])

	const login = async (event: FormEvent) => {
		event.preventDefault()
		setBusy(true)
		setError(null)
		try {
			const res = await fetch('/api/users/login', {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, password }),
			})
			const body = (await res.json()) as { user?: AuthUser; errors?: { message: string }[] }
			if (!res.ok || !body.user?.id) {
				setError(body.errors?.[0]?.message ?? `login failed (${res.status})`)
				return
			}
			setUser({ id: String(body.user.id), email: body.user.email, name: body.user.name })
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
		} finally {
			setBusy(false)
		}
	}

	const logout = async () => {
		await fetch('/api/users/logout', { method: 'POST', credentials: 'include' })
		setUser(null)
	}

	if (!authChecked) {
		return <main style={pageStyle}>Loading…</main>
	}

	return (
		<main style={pageStyle}>
			<h1 style={{ margin: '0 0 0.5rem' }}>SSE playground</h1>
			<p style={ledeStyle}>
				Open two browsers for presence. Switch tenant to see isolation. <a href="/admin">Admin</a>
			</p>
			<ul style={{ margin: '0 0 1.5rem', paddingLeft: '1.2rem', lineHeight: 1.6 }}>
				{CREDENTIALS.map((row) => (
					<li key={row.email}>
						<code>{row.email}</code> / <code>{row.password}</code> ({row.label})
					</li>
				))}
			</ul>
			{user ? (
				<Session user={user} onLogout={() => void logout()} />
			) : (
				<form onSubmit={(event) => void login(event)} style={formStyle}>
					<label>
						Email
						<input
							value={email}
							onChange={(event) => setEmail(event.target.value)}
							autoComplete="username"
							style={inputStyle}
						/>
					</label>
					<label>
						Password
						<input
							type="password"
							value={password}
							onChange={(event) => setPassword(event.target.value)}
							autoComplete="current-password"
							style={inputStyle}
						/>
					</label>
					<button type="submit" disabled={busy}>
						Log in
					</button>
					{error ? <p style={errorStyle}>{error}</p> : null}
				</form>
			)}
		</main>
	)
}

const Session = ({ user, onLogout }: { user: AuthUser; onLogout: () => void }) => {
	const [tenants, setTenants] = useState<TenantDoc[]>([])
	const [tenantId, setTenantId] = useState(() => readCookie(TENANT_COOKIE))
	const [pages, setPages] = useState<PageDoc[]>([])
	const [selectedId, setSelectedId] = useState<string | null>(null)
	const [pingError, setPingError] = useState<string | null>(null)
	const { status, generation, lastEvent } = usePayloadList({ collection: 'pages' })
	const raw = usePayloadSubscription({
		topics: selectedId ? ['pages', `pages:${selectedId}`] : ['pages'],
	})

	useEffect(() => {
		void fetch('/api/tenants?limit=50&depth=0', { credentials: 'include' })
			.then(async (res) => {
				if (!res.ok) return []
				const body = (await res.json()) as { docs?: TenantDoc[] }
				return body.docs ?? []
			})
			.then(setTenants)
			.catch(() => setTenants([]))
	}, [])

	const loadPages = useCallback(async () => {
		const res = await fetch('/api/pages?limit=50&depth=0', { credentials: 'include' })
		if (!res.ok) {
			setPages([])
			return
		}
		const body = (await res.json()) as { docs?: PageDoc[] }
		setPages(body.docs ?? [])
	}, [])

	useEffect(() => {
		void loadPages()
	}, [generation, loadPages])

	const applyTenant = () => {
		if (!tenantId) {
			// biome-ignore lint/suspicious/noDocumentCookie: clear the tenant selector
			document.cookie = `${TENANT_COOKIE}=; path=/; max-age=0`
		} else {
			setTenantCookie(tenantId)
		}
		window.location.reload()
	}

	const emitPing = async () => {
		setPingError(null)
		const res = await fetch('/api/ping', { method: 'POST', credentials: 'include' })
		if (!res.ok) {
			setPingError((await res.text()) || `ping ${res.status}`)
		}
	}

	return (
		<section>
			<p>
				Signed in as <strong>{user.name || user.email}</strong>{' '}
				<button type="button" onClick={onLogout}>
					Log out
				</button>
			</p>
			<div style={rowStyle}>
				<label>
					Tenant cookie
					<select
						value={tenantId}
						onChange={(event) => setTenantId(event.target.value)}
						style={{ ...inputStyle, width: 'auto' }}
					>
						<option value="">(none / wildcard if admin)</option>
						{tenants.map((tenant) => (
							<option key={tenant.id} value={String(tenant.id)}>
								{tenant.name ?? tenant.id}
							</option>
						))}
					</select>
				</label>
				<button type="button" onClick={applyTenant}>
					Apply and reload
				</button>
				<button type="button" onClick={() => void emitPing()}>
					Emit ping
				</button>
				<span>
					list: <code>{status}</code> gen {generation}
				</span>
			</div>
			{pingError ? <p style={errorStyle}>{pingError}</p> : null}
			<h2 style={h2Style}>Pages</h2>
			{pages.length === 0 ? (
				<p>No pages in this tenant.</p>
			) : (
				<ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
					{pages.map((page) => (
						<li key={page.id}>
							<button
								type="button"
								onClick={() => setSelectedId(String(page.id))}
								style={{
									...rowButtonStyle,
									fontWeight: selectedId === String(page.id) ? 700 : 400,
								}}
							>
								{page.title ?? page.id} <code>{page.status ?? '-'}</code>
							</button>
						</li>
					))}
				</ul>
			)}
			{selectedId ? (
				<DocumentPanel collection="pages" id={selectedId} selfId={user.id} />
			) : (
				<p style={{ color: '#555' }}>Click a row for document, presence, and conflict.</p>
			)}
			<h2 style={h2Style}>Raw lastEvent</h2>
			<p>
				subscription: <code>{raw.status}</code>
			</p>
			<pre style={preStyle}>{jsonPre(raw.lastEvent ?? lastEvent)}</pre>
		</section>
	)
}

const DocumentPanel = ({
	collection,
	id,
	selfId,
}: {
	collection: string
	id: string
	selfId: string
}) => {
	const [dirty, setDirty] = useState(false)
	const { status, doc, lastEvent } = usePayloadDocument<PageDoc>({ collection, id })
	const presence = useDocumentPresence(collection, id, { mode: dirty ? 'editing' : 'viewing' })
	const { conflict, dismiss } = useDocumentConflict({
		collection,
		id,
		selfId,
		modified: dirty,
	})

	return (
		<div style={panelStyle}>
			<h2 style={h2Style}>Document {id}</h2>
			<p>
				stream: <code>{status}</code> presence: <code>{presence.status}</code>
			</p>
			<label>
				<input
					type="checkbox"
					checked={dirty}
					onChange={(event) => setDirty(event.target.checked)}
				/>{' '}
				form dirty (conflict + editing presence)
			</label>
			{conflict ? (
				<p style={conflictStyle}>
					Conflict: {conflict.operation} by {conflict.actorId ?? 'unknown'}{' '}
					<button type="button" onClick={dismiss}>
						Dismiss
					</button>
				</p>
			) : null}
			<p>
				Peers:{' '}
				{presence.peers.length === 0
					? 'none'
					: presence.peers.map((peer) => `${peer.label} (${peer.mode})`).join(', ')}
			</p>
			<pre style={preStyle}>{jsonPre(doc ?? lastEvent)}</pre>
		</div>
	)
}

const pageStyle: CSSProperties = {
	maxWidth: 720,
	margin: '0 auto',
	padding: '2rem 1.25rem 4rem',
	lineHeight: 1.5,
}
const ledeStyle: CSSProperties = { margin: '0 0 1rem', color: '#333' }
const formStyle: CSSProperties = {
	display: 'grid',
	gap: '0.75rem',
	maxWidth: 320,
}
const inputStyle: CSSProperties = { display: 'block', width: '100%', marginTop: 4, padding: 6 }
const errorStyle: CSSProperties = { color: '#b00020', margin: 0 }
const rowStyle: CSSProperties = {
	display: 'flex',
	flexWrap: 'wrap',
	gap: '0.75rem',
	alignItems: 'end',
	margin: '1rem 0',
}
const h2Style: CSSProperties = { fontSize: '1.1rem', margin: '1.5rem 0 0.5rem' }
const preStyle: CSSProperties = {
	background: '#f4f4f4',
	padding: '0.75rem',
	overflow: 'auto',
	fontSize: 12,
}
const panelStyle: CSSProperties = {
	marginTop: '1rem',
	padding: '1rem',
	border: '1px solid #ddd',
}
const conflictStyle: CSSProperties = { color: '#8a5a00', fontWeight: 600 }
const rowButtonStyle: CSSProperties = {
	background: 'none',
	border: 0,
	padding: '0.25rem 0',
	cursor: 'pointer',
	textAlign: 'left',
}
