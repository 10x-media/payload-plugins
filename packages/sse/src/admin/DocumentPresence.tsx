'use client'

import { useAuth, useDocumentInfo } from '@payloadcms/ui'

import { useDocumentPresence } from '../client/useDocumentPresence'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'

const initialsFor = (label: string): string => {
	const parts = label.trim().split(/\s+/).filter(Boolean)
	if (parts.length === 0) return '?'
	if (parts.length === 1) {
		const first = parts[0] ?? '?'
		return first.slice(0, 2).toUpperCase()
	}
	const a = parts[0]?.[0] ?? ''
	const b = parts[1]?.[0] ?? ''
	return `${a}${b}`.toUpperCase()
}

/**
 * Viewer-presence chip row for a document edit view. Ignores Payload document locks.
 */
export const DocumentPresence = () => {
	const { t } = useTranslation()
	const { id, collectionSlug } = useDocumentInfo()
	const { user } = useAuth()
	const docId = id == null ? '' : String(id)
	const collection = collectionSlug ?? ''
	const enabled = Boolean(collection && docId)

	const { peers, self } = useDocumentPresence(collection, docId)

	if (!enabled || !user) {
		return null
	}

	const selfId = self?.id ?? String((user as { id?: unknown }).id ?? '')
	const others = peers.filter((peer) => peer.id !== selfId)
	if (others.length === 0) {
		return null
	}

	return (
		<div
			style={{
				alignItems: 'center',
				display: 'flex',
				gap: '0.5rem',
				color: 'var(--theme-elevation-800)',
				fontSize: '0.8125rem',
			}}
		>
			<ul
				style={{
					display: 'flex',
					gap: '0.25rem',
					listStyle: 'none',
					margin: 0,
					padding: 0,
				}}
			>
				{others.map((peer) => (
					<li
						key={peer.id}
						title={peer.label}
						style={{
							alignItems: 'center',
							background: 'var(--theme-elevation-150)',
							borderRadius: '999px',
							display: 'inline-flex',
							fontWeight: 600,
							height: '1.75rem',
							justifyContent: 'center',
							minWidth: '1.75rem',
							padding: '0 0.4rem',
						}}
					>
						{initialsFor(peer.label)}
					</li>
				))}
			</ul>
			<span>{t(keys.alsoViewing)}</span>
		</div>
	)
}
