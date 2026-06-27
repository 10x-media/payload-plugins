'use client'

import { Button } from '@payloadcms/ui'
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
				results: Record<string, { synced: number; errors: number }>
			}
			const entityResult = data.results[entity]
			if (entityResult) {
				setResult(
					`${entityResult.synced} synced${entityResult.errors > 0 ? `, ${entityResult.errors} errors` : ''}`
				)
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

	const buttonLabel =
		state === 'syncing'
			? 'Syncing...'
			: state === 'success'
				? `Synced${result ? ` (${result})` : ''}`
				: state === 'error'
					? `Error${result ? `: ${result}` : ''}`
					: (label ?? `Sync ${entity}`)

	return (
		<div style={{ marginTop: '1rem' }}>
			<Button
				type="button"
				buttonStyle={state === 'error' ? 'error' : 'secondary'}
				disabled={state === 'syncing'}
				onClick={run}
				size="medium"
			>
				{buttonLabel}
			</Button>
		</div>
	)
}

export const SipgateUsersSyncButton = () => (
	<SipgateSyncButton entity="users" label="Sync Sipgate Users" />
)

export const SipgateDevicesSyncButton = () => (
	<SipgateSyncButton entity="devices" label="Sync Sipgate Devices" />
)

export const SipgateChannelsSyncButton = () => (
	<SipgateSyncButton entity="channels" label="Sync Sipgate Channels" />
)
