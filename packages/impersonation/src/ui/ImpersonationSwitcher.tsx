'use client'

import {
	Button,
	Drawer,
	type ReactSelectOption,
	SelectInput,
	ShimmerEffect,
	TextInput,
	toast,
	useConfig,
	useDrawerSlug,
	useModal,
	useTranslation as usePayloadTranslation,
} from '@payloadcms/ui'
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from 'react'

import { CLIENT_FETCH_TIMEOUT_MS } from '../plugin/constants'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { StartConfirmModal, type StartTarget } from './StartConfirmModal'
import './impersonation.css'

const CONFIRM_SLUG = 'impersonation-confirm-switcher'

type UserHit = { email?: string; id: number | string; name?: string }

export type ImpersonationSwitcherProps = {
	apiPath: string
	collections: { label: string; slug: string }[]
	reasonMode: 'off' | 'optional' | 'required'
	viewerId: number | string
}

const labelOf = (doc: UserHit) => String(doc.name ?? doc.email ?? doc.id ?? '')

const optionValue = (selected: ReactSelectOption | ReactSelectOption[] | null) => {
	const option = Array.isArray(selected) ? selected[0] : selected
	const value = option?.value
	return typeof value === 'string' || typeof value === 'number' ? String(value) : null
}

export const ImpersonationSwitcher = ({
	apiPath,
	collections,
	reasonMode,
	viewerId,
}: ImpersonationSwitcherProps) => {
	const { t } = useTranslation()
	const { t: tAdmin } = usePayloadTranslation()
	const { config } = useConfig()
	const { closeModal, isModalOpen, openModal } = useModal()
	const drawerSlug = useDrawerSlug('impersonation-switcher')
	const drawerOpen = isModalOpen(drawerSlug)

	const [collection, setCollection] = useState(collections[0]?.slug ?? '')
	const [query, setQuery] = useState('')
	const [hits, setHits] = useState<UserHit[]>([])
	const [busy, setBusy] = useState(false)
	const [target, setTarget] = useState<null | StartTarget>(null)
	const abortRef = useRef<AbortController | null>(null)

	const collectionOptions = collections.map((entry) => ({
		label: entry.label,
		value: entry.slug,
	}))

	const search = useCallback(
		async (term: string) => {
			if (!collection) {
				return
			}
			abortRef.current?.abort()
			const controller = new AbortController()
			abortRef.current = controller
			const timeout = window.setTimeout(() => controller.abort(), CLIENT_FETCH_TIMEOUT_MS)
			setBusy(true)
			try {
				const params = new URLSearchParams({ depth: '0', limit: '20' })
				const trimmed = term.trim()
				if (trimmed) {
					const titleField = config.collections.find((entry) => entry.slug === collection)?.admin
						?.useAsTitle
					const clauses: Record<string, unknown>[] = [{ email: { like: trimmed } }]
					if (titleField && titleField !== 'email' && titleField !== 'id') {
						clauses.push({ [titleField]: { like: trimmed } })
					}
					params.set('where', JSON.stringify({ or: clauses }))
				}
				const response = await fetch(`${config.routes.api}/${collection}?${params}`, {
					credentials: 'include',
					signal: controller.signal,
				})
				if (controller.signal.aborted) {
					return
				}
				if (!response.ok) {
					toast.error(t(keys.errorFailed))
					setHits([])
					return
				}
				const body = (await response.json()) as { docs?: UserHit[] }
				setHits((body.docs ?? []).filter((doc) => String(doc.id) !== String(viewerId)))
			} catch {
				if (controller.signal.aborted) {
					return
				}
				toast.error(t(keys.errorFailed))
				setHits([])
			} finally {
				window.clearTimeout(timeout)
				if (abortRef.current === controller) {
					setBusy(false)
				}
			}
		},
		[collection, config.collections, config.routes.api, t, viewerId]
	)

	useEffect(() => {
		if (!drawerOpen) {
			abortRef.current?.abort()
			return
		}
		const handle = window.setTimeout(() => {
			void search(query)
		}, 250)
		return () => window.clearTimeout(handle)
	}, [drawerOpen, query, search])

	const pick = (hit: UserHit) => {
		setTarget({ collection, id: hit.id, label: labelOf(hit) })
		closeModal(drawerSlug)
		openModal(CONFIRM_SLUG)
	}

	return (
		<>
			<Button buttonStyle="pill" onClick={() => openModal(drawerSlug)} size="small">
				<span data-testid="impersonation-switcher">{t(keys.switchToUser)}</span>
			</Button>
			<Drawer slug={drawerSlug} title={t(keys.switchToUser)}>
				<div className="impersonation-switcher">
					{collections.length > 1 ? (
						<SelectInput
							isClearable={false}
							label={tAdmin('general:collections')}
							name="impersonation-collection"
							onChange={(selected) => {
								const value = optionValue(selected)
								if (value) {
									setCollection(value)
								}
							}}
							options={collectionOptions}
							path="impersonation-collection"
							value={collection}
						/>
					) : null}
					<TextInput
						label={t(keys.searchUsers)}
						onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === 'Enter') {
								event.preventDefault()
								void search(query)
							}
						}}
						path="impersonation-search"
						placeholder={t(keys.searchUsers)}
						value={query}
					/>
					<div className="impersonation-switcher__results">
						{busy && hits.length === 0 ? <ShimmerEffect height="2rem" /> : null}
						{!busy && hits.length === 0 ? (
							<p className="impersonation-switcher__empty">{t(keys.noResults)}</p>
						) : null}
						{hits.map((hit) => (
							<Button
								buttonStyle="secondary"
								disabled={busy}
								key={String(hit.id)}
								margin={false}
								onClick={() => pick(hit)}
								size="small"
							>
								{labelOf(hit)}
							</Button>
						))}
					</div>
					<div className="impersonation-switcher__controls">
						<Button
							buttonStyle="secondary"
							margin={false}
							onClick={() => closeModal(drawerSlug)}
							size="large"
						>
							{t(keys.cancel)}
						</Button>
					</div>
				</div>
			</Drawer>
			<StartConfirmModal
				apiPath={apiPath}
				key={target ? `${target.collection}:${target.id}` : 'idle'}
				modalSlug={CONFIRM_SLUG}
				reasonMode={reasonMode}
				target={target}
			/>
		</>
	)
}
