'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button } from '@/components/ui/button'

/**
 * Payload's own login for the `customers` collection. How a website signs
 * people in is the project's business; the conversations endpoints only need
 * the request to carry Payload auth.
 */
export function LoginForm() {
	const router = useRouter()
	const [email, setEmail] = useState('customer@example.com')
	const [password, setPassword] = useState('password')
	const [error, setError] = useState<null | string>(null)
	return (
		<form
			className="mx-auto mt-24 flex w-full max-w-sm flex-col gap-3 rounded-xl border p-6"
			onSubmit={async (event) => {
				event.preventDefault()
				const res = await fetch('/api/customers/login', {
					body: JSON.stringify({ email, password }),
					credentials: 'include',
					headers: { 'Content-Type': 'application/json' },
					method: 'POST',
				})
				if (res.ok) router.refresh()
				else setError('Wrong email or password.')
			}}
		>
			<h1 className="font-semibold text-lg">Customer login</h1>
			<p className="text-muted-foreground text-sm">
				Signs out of the admin in this browser: Payload uses one session cookie. Use a private
				window.
			</p>
			<input
				className="h-9 rounded-md border px-3 text-sm"
				onChange={(event) => setEmail(event.target.value)}
				placeholder="Email"
				value={email}
			/>
			<input
				className="h-9 rounded-md border px-3 text-sm"
				onChange={(event) => setPassword(event.target.value)}
				placeholder="Password"
				type="password"
				value={password}
			/>
			{error ? <p className="text-destructive text-sm">{error}</p> : null}
			<Button type="submit">Sign in</Button>
		</form>
	)
}

export function LogoutButton() {
	const router = useRouter()
	return (
		<Button
			onClick={async () => {
				await fetch('/api/customers/logout', { credentials: 'include', method: 'POST' })
				router.refresh()
			}}
			size="sm"
			variant="ghost"
		>
			Sign out
		</Button>
	)
}
