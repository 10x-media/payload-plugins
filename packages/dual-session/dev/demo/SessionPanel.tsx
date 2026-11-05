'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

type Credentials = { email: string; password: string }

const post = async (path: string, body?: unknown) =>
	fetch(path, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: body ? JSON.stringify(body) : undefined,
	})

/**
 * Login and logout for one auth collection, driven through Payload's REST endpoints so
 * the cookie the browser ends up holding is the one the plugin writes.
 */
export const SessionPanel = ({
	collection,
	cookieName,
	defaults,
	title,
}: {
	collection: string
	cookieName: string
	defaults: Credentials
	title: string
}) => {
	const router = useRouter()
	const [credentials, setCredentials] = useState<Credentials>(defaults)
	const [status, setStatus] = useState<string>('')
	const [pending, setPending] = useState(false)

	const run = async (action: 'login' | 'logout') => {
		setPending(true)
		setStatus('')
		try {
			const response = await post(
				`/api/${collection}/${action}`,
				action === 'login' ? credentials : undefined
			)
			const result = (await response.json()) as { errors?: { message: string }[] }
			setStatus(response.ok ? `${action} ok` : (result.errors?.[0]?.message ?? `${action} failed`))
			router.refresh()
		} finally {
			setPending(false)
		}
	}

	return (
		<section style={{ border: '1px solid #ccc', borderRadius: 8, padding: '1rem' }}>
			<h3 style={{ marginTop: 0 }}>{title}</h3>
			<p style={{ color: '#666', fontSize: '0.85rem', margin: '0 0 0.75rem' }}>
				<code>{cookieName}</code>
			</p>
			<div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
				<input
					aria-label={`${collection} email`}
					onChange={(event) => setCredentials({ ...credentials, email: event.target.value })}
					type="email"
					value={credentials.email}
				/>
				<input
					aria-label={`${collection} password`}
					onChange={(event) => setCredentials({ ...credentials, password: event.target.value })}
					type="password"
					value={credentials.password}
				/>
				<button disabled={pending} onClick={() => run('login')} type="button">
					Log in
				</button>
				<button disabled={pending} onClick={() => run('logout')} type="button">
					Log out
				</button>
			</div>
			{status ? <p style={{ marginBottom: 0 }}>{status}</p> : null}
		</section>
	)
}
