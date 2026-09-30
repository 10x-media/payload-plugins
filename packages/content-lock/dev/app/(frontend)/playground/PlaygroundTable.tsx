'use client'

import { useState } from 'react'

import { localWrite, type WriteResult } from './actions'
import { sampleData } from './sample'

export type PlaygroundEntity = { kind: 'collection' | 'global'; slug: string; locked: boolean }

type Mode = 'rest' | 'local' | 'localOverride'

type Outcome = {
	mode: Mode
	at: string
	status?: number
	retryAfter?: string | null
	body: unknown
}

const MODE_LABEL: Record<Mode, string> = {
	rest: 'REST (admin session)',
	local: 'Local API, overrideAccess: false',
	localOverride: 'Local API, overrideAccess: true',
}

const restWrite = async (entity: PlaygroundEntity): Promise<Omit<Outcome, 'mode' | 'at'>> => {
	const url = entity.kind === 'global' ? `/api/globals/${entity.slug}` : `/api/${entity.slug}`
	const response = await fetch(url, {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(sampleData(entity.kind, entity.slug)),
	})
	const text = await response.text()
	let body: unknown = text
	try {
		body = JSON.parse(text)
	} catch {
		// Not JSON: show it as text.
	}
	return { status: response.status, retryAfter: response.headers.get('Retry-After'), body }
}

const localOutcome = (result: WriteResult): Omit<Outcome, 'mode' | 'at'> => ({
	status: result.ok ? 200 : result.status,
	body: result,
})

const cell = { borderBottom: '1px solid #ddd', padding: '0.5rem', verticalAlign: 'top' } as const

/** One row per entity: three ways to write, and the last answer of each. */
export const PlaygroundTable = ({ entities }: { entities: PlaygroundEntity[] }) => {
	const [outcomes, setOutcomes] = useState<Record<string, Outcome | undefined>>({})
	const [busy, setBusy] = useState<string | null>(null)

	const run = async (entity: PlaygroundEntity, mode: Mode) => {
		const key = `${entity.kind}:${entity.slug}`
		setBusy(`${key}:${mode}`)
		try {
			const result =
				mode === 'rest'
					? await restWrite(entity)
					: localOutcome(
							await localWrite({
								kind: entity.kind,
								slug: entity.slug,
								overrideAccess: mode === 'localOverride',
							})
						)
			setOutcomes((prior) => ({
				...prior,
				[key]: { mode, at: new Date().toLocaleTimeString(), ...result },
			}))
		} finally {
			setBusy(null)
		}
	}

	return (
		<table style={{ borderCollapse: 'collapse', width: '100%' }}>
			<thead>
				<tr>
					<th style={{ ...cell, textAlign: 'left' }}>Entity</th>
					<th style={{ ...cell, textAlign: 'left' }}>Try</th>
					<th style={{ ...cell, textAlign: 'left' }}>Last answer</th>
				</tr>
			</thead>
			<tbody>
				{entities.map((entity) => {
					const key = `${entity.kind}:${entity.slug}`
					const outcome = outcomes[key]
					return (
						<tr key={key}>
							<td style={cell}>
								<code>{entity.slug}</code>
								<div style={{ color: '#666', fontSize: '0.85em' }}>
									{entity.kind} · {entity.locked ? '🔒 locked' : 'open'}
								</div>
							</td>
							<td style={cell}>
								{(Object.keys(MODE_LABEL) as Mode[]).map((mode) => (
									<div key={mode} style={{ marginBottom: '0.25rem' }}>
										<button
											disabled={busy !== null}
											onClick={() => void run(entity, mode)}
											type="button"
										>
											{busy === `${key}:${mode}` ? '…' : MODE_LABEL[mode]}
										</button>
									</div>
								))}
							</td>
							<td style={{ ...cell, maxWidth: '28rem' }}>
								{outcome ? (
									<>
										<div>
											<strong>{outcome.status ?? '?'}</strong> · {MODE_LABEL[outcome.mode]} ·{' '}
											{outcome.at}
											{outcome.retryAfter ? ` · Retry-After: ${outcome.retryAfter}` : ''}
										</div>
										<pre
											style={{
												background: '#f6f6f6',
												fontSize: '0.8em',
												margin: '0.25rem 0 0',
												maxHeight: '12rem',
												overflow: 'auto',
												padding: '0.5rem',
												whiteSpace: 'pre-wrap',
											}}
										>
											{JSON.stringify(outcome.body, null, 2)}
										</pre>
									</>
								) : (
									<span style={{ color: '#999' }}>not tried</span>
								)}
							</td>
						</tr>
					)
				})}
			</tbody>
		</table>
	)
}
