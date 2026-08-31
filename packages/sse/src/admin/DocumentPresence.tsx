'use client'

import { useAuth, useConfig, useDocumentDrawer, useDocumentInfo } from '@payloadcms/ui'
import type { CollectionSlug } from 'payload'

import { type PresencePeerPublic, useDocumentPresence } from '../client/useDocumentPresence'
import type { PresenceProfile } from '../options'
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

export type DocumentPresenceProps = {
	profile?: PresenceProfile
}

type ChipProps = {
	adminRoute: string
	peer: PresencePeerPublic
	usersSlug: string
}

const userDocPath = (adminRoute: string, usersSlug: string, id: string): string =>
	`${adminRoute}/collections/${usersSlug}/${id}`

const PresenceChipNone = ({ peer }: { peer: PresencePeerPublic }) => (
	<li className="sse-document-presence-chip" title={peer.label}>
		{initialsFor(peer.label)}
	</li>
)

const PresenceChipNewTab = ({ adminRoute, peer, usersSlug }: ChipProps) => (
	<li className="sse-document-presence-chip sse-document-presence-chip--clickable">
		<button
			onClick={() => {
				window.open(userDocPath(adminRoute, usersSlug, peer.id), '_blank', 'noopener,noreferrer')
			}}
			title={peer.label}
			type="button"
		>
			{initialsFor(peer.label)}
		</button>
	</li>
)

/**
 * One drawer hook per peer. `useDocumentDrawer` builds the drawer once from
 * `id`; sharing one hook across chips would stick to the first peer.
 */
const PresenceChipDrawer = ({ peer, usersSlug }: Omit<ChipProps, 'adminRoute'>) => {
	const [DocumentDrawer, , { openDrawer }] = useDocumentDrawer({
		collectionSlug: usersSlug as CollectionSlug,
		id: peer.id,
	})
	return (
		<li className="sse-document-presence-chip sse-document-presence-chip--clickable">
			<button onClick={openDrawer} title={peer.label} type="button">
				{initialsFor(peer.label)}
			</button>
			<DocumentDrawer />
		</li>
	)
}

/**
 * Viewer-presence chip row for a document edit view. Ignores Payload document locks.
 */
export const DocumentPresence = ({ profile = 'none' }: DocumentPresenceProps) => {
	const { t } = useTranslation()
	const { id, collectionSlug } = useDocumentInfo()
	const { user } = useAuth()
	const { config } = useConfig()
	const docId = id == null ? '' : String(id)
	const collection = collectionSlug ?? ''
	const enabled = Boolean(collection && docId)
	const usersSlug = String(config.admin.user)
	const adminRoute = config.routes.admin ?? '/admin'

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
				{others.map((peer) => {
					if (profile === 'drawer') {
						return <PresenceChipDrawer key={peer.id} peer={peer} usersSlug={usersSlug} />
					}
					if (profile === 'newTab') {
						return (
							<PresenceChipNewTab
								adminRoute={adminRoute}
								key={peer.id}
								peer={peer}
								usersSlug={usersSlug}
							/>
						)
					}
					return <PresenceChipNone key={peer.id} peer={peer} />
				})}
			</ul>
			<span>{t(keys.alsoViewing)}</span>
		</div>
	)
}
