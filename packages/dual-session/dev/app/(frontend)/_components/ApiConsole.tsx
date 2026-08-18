'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export type ApiAction = {
	body?: Record<string, unknown>
	/** What the plugin's behaviour predicts, shown next to the button. */
	expectation: string
	/** Extra request headers, for probing what a client can and cannot influence. */
	headers?: Record<string, string>
	label: string
	/**
	 * Find the document to write to first. Payload's update-by-id route needs a real id in
	 * the path; without one it falls through to the bulk route and rejects the call for a
	 * missing `where`. The lookup runs under the same scope as the write, so a read that is
	 * itself refused shows up as the first step.
	 */
	lookup?: {
		/** Numeric field to read off the found document and send back incremented. */
		incrementField: string
		/** Collection route to GET; `docs[0]` is the target. */
		path: string
	}
	method: 'GET' | 'PATCH' | 'POST'
	path: string
	/** `'no-referrer'` strips the `Referer` the proxy attributes API calls by. */
	referrerPolicy?: ReferrerPolicy
}

type Step = { body: string; name: string; status: number }

const pretty = (text: string) => {
	try {
		return JSON.stringify(JSON.parse(text), null, 2)
	} catch {
		return text
	}
}

/**
 * Fires REST calls from the website origin, so the auth-scope proxy attributes them by
 * `Referer` exactly as it would for real frontend code.
 */
export const ApiConsole = ({ actions, title }: { actions: ApiAction[]; title: string }) => {
	const router = useRouter()
	const [steps, setSteps] = useState<Step[] | null>(null)
	const [pending, setPending] = useState<string | null>(null)

	const call = async (
		action: ApiAction,
		override: { body?: Record<string, unknown>; method?: string; path?: string } = {}
	) => {
		const body = 'body' in override ? override.body : action.body
		const response = await fetch(override.path ?? action.path, {
			method: override.method ?? action.method,
			credentials: 'include',
			headers: {
				...(body ? { 'Content-Type': 'application/json' } : {}),
				...action.headers,
			},
			body: body ? JSON.stringify(body) : undefined,
			referrerPolicy: action.referrerPolicy,
		})
		return { response, text: (await response.text()).slice(0, 2000) }
	}

	const run = async (action: ApiAction) => {
		setPending(action.label)
		setSteps(null)
		try {
			if (!action.lookup) {
				const { response, text } = await call(action)
				setSteps([
					{ name: `${action.method} ${action.path}`, status: response.status, body: pretty(text) },
				])
				router.refresh()
				return
			}

			const { incrementField, path: lookupPath } = action.lookup
			const found = await call(action, { body: undefined, method: 'GET', path: lookupPath })
			const lookupStep: Step = {
				name: `GET ${lookupPath}`,
				status: found.response.status,
				body: pretty(found.text),
			}

			const doc = found.response.ok
				? (JSON.parse(found.text) as { docs?: Record<string, unknown>[] }).docs?.[0]
				: undefined

			if (!doc) {
				setSteps([
					lookupStep,
					{ name: 'write', status: 0, body: 'skipped: the lookup returned no document' },
				])
				router.refresh()
				return
			}

			const target = `${action.path}/${doc.id}`
			const current = typeof doc[incrementField] === 'number' ? (doc[incrementField] as number) : 0
			const written = await call(action, {
				body: { ...action.body, [incrementField]: current + 1 },
				path: target,
			})

			setSteps([
				lookupStep,
				{
					name: `${action.method} ${target}`,
					status: written.response.status,
					body: pretty(written.text),
				},
			])
			router.refresh()
		} finally {
			setPending(null)
		}
	}

	return (
		<section style={{ border: '1px solid #ccc', borderRadius: 8, padding: '1rem' }}>
			<h3 style={{ marginTop: 0 }}>{title}</h3>
			<ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
				{actions.map((action) => (
					<li
						key={action.label}
						style={{
							alignItems: 'baseline',
							display: 'flex',
							gap: '0.5rem',
							marginBottom: '0.4rem',
						}}
					>
						<button
							disabled={pending !== null}
							onClick={() => run(action)}
							style={{ minWidth: '15rem', textAlign: 'left' }}
							type="button"
						>
							{action.label}
						</button>
						<span style={{ color: '#666', fontSize: '0.8rem' }}>{action.expectation}</span>
					</li>
				))}
			</ul>
			{steps ? (
				<pre
					style={{
						background: '#f5f5f5',
						borderRadius: 4,
						fontSize: '0.75rem',
						marginBottom: 0,
						maxHeight: '22rem',
						overflow: 'auto',
						padding: '0.75rem',
						whiteSpace: 'pre-wrap',
					}}
				>
					{steps
						.map((step) => `${step.name} → ${step.status || '(skipped)'}\n${step.body}`)
						.join('\n\n')}
				</pre>
			) : null}
		</section>
	)
}
