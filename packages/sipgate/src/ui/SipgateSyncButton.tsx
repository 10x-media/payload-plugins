'use client'

import { useState } from 'react'
import type { SyncEntityType } from '../endpoints/sipgate.sync'

type SyncState = 'idle' | 'syncing' | 'success' | 'error'

type SyncButtonProps = {
	entity: SyncEntityType
	label?: string
}

const SipgateSyncButton = ({ entity, label }: SyncButtonProps) => {
	const [state, setState] = useState<SyncState>('idle')
	const [result, setResult] = useState<string | null>(null)

	const run = async () => {
		if (state === 'syncing') return
		setState('syncing')
		setResult(null)
		try {
			const res = await fetch('/api/sipgate/sync', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ type: entity }),
			})
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const data = (await res.json()) as {
				ok: boolean
				results: Record<string, { synced: number; errors: number; deleted: number }>
			}
			const r = data.results[entity]
			if (r) {
				const parts = [`${r.synced} synced`]
				if (r.deleted > 0) parts.push(`${r.deleted} deleted`)
				if (r.errors > 0) parts.push(`${r.errors} errors`)
				setResult(parts.join(', '))
			} else {
				setResult('Done')
			}
			setState('success')
		} catch (err) {
			setResult(err instanceof Error ? err.message : 'Unknown error')
			setState('error')
		} finally {
			setTimeout(() => {
				setState('idle')
				setResult(null)
			}, 5000)
		}
	}

	const text =
		state === 'syncing'
			? 'Syncing...'
			: state === 'success'
				? `Synced${result ? ` (${result})` : ''}`
				: state === 'error'
					? `Error${result ? `: ${result}` : ''}`
					: (label ?? `Sync ${entity}`)

	return (
		<button
			type="button"
			onClick={run}
			disabled={state === 'syncing'}
			style={{
				display: 'block',
				width: '100%',
				padding: '8px 16px',
				background: 'transparent',
				border: 'none',
				textAlign: 'left',
				cursor: state === 'syncing' ? 'default' : 'pointer',
				color:
					state === 'error'
						? 'var(--theme-error-500)'
						: state === 'success'
							? 'var(--theme-success-500)'
							: 'var(--theme-text)',
				fontSize: 'inherit',
				opacity: state === 'syncing' ? 0.6 : 1,
				whiteSpace: 'nowrap',
			}}
		>
			{text}
		</button>
	)
}

export const SipgateUsersSyncButton = () => <SipgateSyncButton entity="users" label="Sync Users" />

export const SipgateDevicesSyncButton = () => (
	<SipgateSyncButton entity="devices" label="Sync Devices" />
)

export const SipgateChannelsSyncButton = () => (
	<SipgateSyncButton entity="channels" label="Sync Channels" />
)
