'use client'

import { Button, toast, useConfig } from '@payloadcms/ui'
import { useCallback, useState } from 'react'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { errorKey, goAfterSwitch, postImpersonation } from './api'
import './impersonation.css'

type UserHit = { email?: string; id: number | string; name?: string }

export type ImpersonationSwitcherProps = {
	apiPath: string
	collections: { label: string; slug: string }[]
	reasonMode: 'off' | 'optional' | 'required'
	viewerId: number | string
}

export const ImpersonationSwitcher = ({
	apiPath,
	collections,
	reasonMode,
	viewerId,
}: ImpersonationSwitcherProps) => {
	const { t } = useTranslation()
	const { config } = useConfig()
	const [open, setOpen] = useState(false)
	const [collection, setCollection] = useState(collections[0]?.slug ?? '')
	const [query, setQuery] = useState('')
	const [hits, setHits] = useState<UserHit[]>([])
	const [pending, setPending] = useState<UserHit | null>(null)
	const [reason, setReason] = useState('')

	const search = useCallback(async () => {
		if (!collection) {
			return
		}
		const params = new URLSearchParams({
			depth: '0',
			limit: '20',
			...(query
				? { where: JSON.stringify({ or: [{ email: { like: query } }, { name: { like: query } }] }) }
				: {}),
		})
		const response = await fetch(`${config.routes.api}/${collection}?${params}`, {
			credentials: 'include',
		})
		if (!response.ok) {
			setHits([])
			return
		}
		const body = (await response.json()) as { docs?: UserHit[] }
		setHits((body.docs ?? []).filter((doc) => String(doc.id) !== String(viewerId)))
	}, [collection, config.routes.api, query, viewerId])

	const start = async () => {
		if (!pending) {
			return
		}
		const result = await postImpersonation(`${apiPath}/start`, {
			collection,
			id: pending.id,
			reason: reasonMode === 'off' ? undefined : reason,
		})
		if (!result.ok) {
			toast.error(result.error ? t(errorKey(result.error)) : t(keys.errorFailed))
			return
		}
		goAfterSwitch(result.redirect)
	}

	return (
		<>
			<Button
				buttonStyle="pill"
				onClick={() => {
					setOpen(true)
					void search()
				}}
				size="small"
			>
				<span data-testid="impersonation-switcher">{t(keys.switchToUser)}</span>
			</Button>
			{open ? (
				<div className="impersonation-overlay">
					<div className="impersonation-dialog" role="dialog">
						<h2>{pending ? t(keys.confirmTitle) : t(keys.switchToUser)}</h2>
						{collections.length > 1 && !pending ? (
							<select onChange={(event) => setCollection(event.target.value)} value={collection}>
								{collections.map((entry) => (
									<option key={entry.slug} value={entry.slug}>
										{entry.label}
									</option>
								))}
							</select>
						) : null}
						{pending ? (
							<>
								<p>
									{pending.name ?? pending.email} ({collection})
								</p>
								{reasonMode !== 'off' ? (
									<label>
										{t(keys.reasonLabel)}
										<input
											onChange={(event) => setReason(event.target.value)}
											placeholder={t(keys.reasonPlaceholder)}
											value={reason}
										/>
									</label>
								) : null}
								<div className="impersonation-dialog__actions">
									<Button buttonStyle="secondary" onClick={() => setPending(null)}>
										{t(keys.cancel)}
									</Button>
									<Button onClick={() => void start()}>
										<span data-testid="impersonation-confirm">{t(keys.confirm)}</span>
									</Button>
								</div>
							</>
						) : (
							<>
								<input
									onChange={(event) => setQuery(event.target.value)}
									onKeyDown={(event) => {
										if (event.key === 'Enter') {
											void search()
										}
									}}
									placeholder={t(keys.searchUsers)}
									value={query}
								/>
								<ul className="impersonation-dialog__list">
									{hits.length === 0 ? <li>{t(keys.noResults)}</li> : null}
									{hits.map((hit) => (
										<li key={String(hit.id)}>
											<button
												className="impersonation-dialog__item"
												onClick={() => setPending(hit)}
												type="button"
											>
												{hit.name ?? hit.email ?? hit.id}
											</button>
										</li>
									))}
								</ul>
								<div className="impersonation-dialog__actions">
									<Button buttonStyle="secondary" onClick={() => setOpen(false)}>
										{t(keys.cancel)}
									</Button>
									<Button buttonStyle="secondary" onClick={() => void search()}>
										{t(keys.searchUsers)}
									</Button>
								</div>
							</>
						)}
					</div>
				</div>
			) : null}
		</>
	)
}
