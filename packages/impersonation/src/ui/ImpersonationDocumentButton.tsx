'use client'

import {
	Button,
	useAuth,
	useConfig,
	useDocumentInfo,
	useDocumentTitle,
	useModal,
} from '@payloadcms/ui'
import { useEffect, useMemo, useState } from 'react'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { ImpersonateIcon } from './ImpersonateIcon'
import { StartConfirmModal, type StartTarget } from './StartConfirmModal'
import { useImpersonation } from './useImpersonation'

const CONFIRM_SLUG = 'impersonation-confirm-document'

export const ImpersonationDocumentButton = () => {
	const { collectionSlug, data, id } = useDocumentInfo()
	const { title } = useDocumentTitle()
	const { user } = useAuth()
	const { config } = useConfig()
	const { t } = useTranslation()
	const { openModal } = useModal()
	const { apiPath, reasonMode, status, targetFilters } = useImpersonation()
	const filter = collectionSlug ? targetFilters[collectionSlug] : undefined
	const [matchesFilter, setMatchesFilter] = useState(filter === true)

	useEffect(() => {
		if (!collectionSlug || id === undefined || filter === undefined || filter === true) {
			setMatchesFilter(filter === true)
			return
		}
		const controller = new AbortController()
		const params = new URLSearchParams({
			depth: '0',
			limit: '1',
			where: JSON.stringify({ and: [{ id: { equals: id } }, filter] }),
		})
		void fetch(`${config.routes.api}/${collectionSlug}?${params.toString()}`, {
			credentials: 'include',
			signal: controller.signal,
		})
			.then(async (response) => {
				if (!response.ok) {
					return { docs: [] }
				}
				return (await response.json()) as { docs?: unknown[] }
			})
			.then((body) => {
				if (!controller.signal.aborted) {
					setMatchesFilter((body.docs?.length ?? 0) > 0)
				}
			})
			.catch(() => {
				if (!controller.signal.aborted) {
					setMatchesFilter(false)
				}
			})
		return () => controller.abort()
	}, [collectionSlug, config.routes.api, filter, id])

	const target = useMemo<null | StartTarget>(() => {
		if (!collectionSlug || id === undefined || filter === undefined) {
			return null
		}
		const fromData =
			data && typeof data === 'object'
				? String(
						(data as { email?: string; name?: string }).name ??
							(data as { email?: string }).email ??
							''
					)
				: ''
		return {
			collection: collectionSlug,
			id,
			label: fromData || title || String(id),
		}
	}, [collectionSlug, data, filter, id, title])

	const self =
		user && collectionSlug === user.collection && id !== undefined && String(user.id) === String(id)

	if (!target || !matchesFilter || status.active || self) {
		return null
	}

	return (
		<>
			<Button
				buttonStyle="subtle"
				className="impersonation-document-button"
				margin={false}
				onClick={() => openModal(CONFIRM_SLUG)}
			>
				<span className="impersonation-header-action">
					<ImpersonateIcon />
					<span data-testid="impersonation-document-action">{t(keys.switchToUser)}</span>
				</span>
			</Button>
			<StartConfirmModal
				apiPath={apiPath}
				key={`${target.collection}:${target.id}`}
				modalSlug={CONFIRM_SLUG}
				reasonMode={reasonMode}
				target={target}
			/>
		</>
	)
}
