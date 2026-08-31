'use client'

import {
	useAuth,
	useConfig,
	useDocumentDrawer,
	useDocumentInfo,
	useFormModified,
} from '@payloadcms/ui'
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

const chipClassName = (peer: PresencePeerPublic, extra?: string): string =>
	[
		'sse-document-presence-chip',
		extra,
		peer.mode === 'editing' ? 'sse-document-presence-chip--editing' : '',
	]
		.filter(Boolean)
		.join(' ')

const chipTitle = (peer: PresencePeerPublic, editingLabel: string): string =>
	peer.mode === 'editing' ? `${peer.label} (${editingLabel})` : peer.label

const captionForOthers = (
	others: PresencePeerPublic[],
	t: ReturnType<typeof useTranslation>['t']
): string => {
	const editors = others.filter((peer) => peer.mode === 'editing')
	const first = editors[0]
	const second = editors[1]
	if (!first) {
		return t(keys.alsoViewing)
	}
	if (!second) {
		return t(keys.isEditing, { name: first.label })
	}
	if (editors.length === 2) {
		return t(keys.areEditing, { name: first.label, other: second.label })
	}
	return t(keys.areEditingMany, { name: first.label, count: editors.length - 1 })
}

export type DocumentPresenceProps = {
	profile?: PresenceProfile
}

type ChipProps = {
	adminRoute: string
	editingLabel: string
	peer: PresencePeerPublic
	usersSlug: string
}

const userDocPath = (adminRoute: string, usersSlug: string, id: string): string =>
	`${adminRoute}/collections/${usersSlug}/${id}`

const PresenceChipNone = ({ editingLabel, peer }: Pick<ChipProps, 'editingLabel' | 'peer'>) => (
	<li className={chipClassName(peer)} title={chipTitle(peer, editingLabel)}>
		{initialsFor(peer.label)}
	</li>
)

const PresenceChipNewTab = ({ adminRoute, editingLabel, peer, usersSlug }: ChipProps) => (
	<li className={chipClassName(peer, 'sse-document-presence-chip--clickable')}>
		<button
			onClick={() => {
				window.open(userDocPath(adminRoute, usersSlug, peer.id), '_blank', 'noopener,noreferrer')
			}}
			title={chipTitle(peer, editingLabel)}
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
const PresenceChipDrawer = ({ editingLabel, peer, usersSlug }: Omit<ChipProps, 'adminRoute'>) => {
	const [DocumentDrawer, , { openDrawer }] = useDocumentDrawer({
		collectionSlug: usersSlug as CollectionSlug,
		id: peer.id,
	})
	return (
		<li className={chipClassName(peer, 'sse-document-presence-chip--clickable')}>
			<button onClick={openDrawer} title={chipTitle(peer, editingLabel)} type="button">
				{initialsFor(peer.label)}
			</button>
			<DocumentDrawer />
		</li>
	)
}

/**
 * Viewer-presence chip row for a document edit view. Ignores Payload document locks.
 * Chip mode is advisory: viewing vs editing. It does not block save.
 */
export const DocumentPresence = ({ profile = 'none' }: DocumentPresenceProps) => {
	const { t } = useTranslation()
	const { id, collectionSlug } = useDocumentInfo()
	const { user } = useAuth()
	const { config } = useConfig()
	const modified = useFormModified()
	const docId = id == null ? '' : String(id)
	const collection = collectionSlug ?? ''
	const enabled = Boolean(collection && docId)
	const usersSlug = String(config.admin.user)
	const adminRoute = config.routes.admin ?? '/admin'
	const mode = modified ? 'editing' : 'viewing'
	const editingLabel = t(keys.editing)

	const { peers, self } = useDocumentPresence(collection, docId, { mode })

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
						return (
							<PresenceChipDrawer
								editingLabel={editingLabel}
								key={peer.id}
								peer={peer}
								usersSlug={usersSlug}
							/>
						)
					}
					if (profile === 'newTab') {
						return (
							<PresenceChipNewTab
								adminRoute={adminRoute}
								editingLabel={editingLabel}
								key={peer.id}
								peer={peer}
								usersSlug={usersSlug}
							/>
						)
					}
					return <PresenceChipNone editingLabel={editingLabel} key={peer.id} peer={peer} />
				})}
			</ul>
			<span>{captionForOthers(others, t)}</span>
		</div>
	)
}
