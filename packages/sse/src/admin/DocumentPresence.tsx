'use client'

import { useAuth, useDocumentInfo } from '@payloadcms/ui'

import { useDocumentPresence } from '../client/useDocumentPresence'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import './tokens.css'

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
		<div className="sse-document-presence">
			<ul className="sse-document-presence-list">
				{others.map((peer) => (
					<li className="sse-document-presence-chip" key={peer.id} title={peer.label}>
						{initialsFor(peer.label)}
					</li>
				))}
			</ul>
			<span>{t(keys.alsoViewing)}</span>
		</div>
	)
}
