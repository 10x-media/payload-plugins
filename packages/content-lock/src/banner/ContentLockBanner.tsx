'use client'

import './banner.css'

import { ChevronIcon, usePreferences } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { formatCountdown } from './formatDate'
import { LocalDate } from './LocalDate'

const PREFERENCE_KEY = 'content-lock-dismissed'
const baseClass = 'content-lock-banner'

/** One lock window as the banner shows it. */
export type BannerItem = {
	id: string
	status: 'announced' | 'active'
	/** Labels of what the window freezes, or `null` for everything. */
	scopeLabels: string[] | null
	startsAt: string
	/** This window's known end, or `null` when it ends manually. */
	endsAt: string | null
	/** Identity of the announcement; changes when the window is rescheduled. */
	dismissKey: string
	/** The window's rendered message for its current stage, if it has one. */
	message: ReactNode
}

export type ContentLockBannerProps = {
	/** Active and announced windows, most relevant first. */
	items: BannerItem[]
	countdownThresholdMs: number
}

/** Live `Ends in` counter that refreshes the page once the lock is over. */
const Countdown = ({ endsAt }: { endsAt: string }) => {
	const { t } = useTranslation()
	const router = useRouter()
	const refreshed = useRef(false)
	const [left, setLeft] = useState(() => Date.parse(endsAt) - Date.now())
	useEffect(() => {
		const timer = setInterval(() => setLeft(Date.parse(endsAt) - Date.now()), 1000)
		return () => clearInterval(timer)
	}, [endsAt])
	useEffect(() => {
		if (left <= 0 && !refreshed.current) {
			refreshed.current = true
			router.refresh()
		}
	}, [left, router])
	return (
		<span className={`${baseClass}__countdown`} suppressHydrationWarning>
			{t(keys.bannerEndsIn, { time: formatCountdown(left) })}
		</span>
	)
}

/**
 * The admin-wide notice for lock windows. It shows one window at a time and
 * pages through the rest. A window's own message for its stage replaces the
 * built-in text, which stays as the fallback. Announcements can be dismissed per user (stored in
 * preferences, so it follows them across devices), which reveals the next
 * one; an active lock cannot be dismissed.
 */
export const ContentLockBanner = ({ items, countdownThresholdMs }: ContentLockBannerProps) => {
	const { t } = useTranslation()
	const { getPreference, setPreference } = usePreferences()
	// Announcements stay hidden until the preference is known, so a dismissed one never flashes.
	const [dismissed, setDismissed] = useState<Set<string> | null>(null)
	const [selectedId, setSelectedId] = useState<string | null>(null)
	const [nearEnd, setNearEnd] = useState(false)

	useEffect(() => {
		let cancelled = false
		void getPreference<string[]>(PREFERENCE_KEY).then((seen) => {
			if (!cancelled) {
				setDismissed(new Set(Array.isArray(seen) ? seen : []))
			}
		})
		return () => {
			cancelled = true
		}
	}, [getPreference])

	// Until the preference is known, show only the leading active windows, so
	// the first notice never swaps out for another once it arrives.
	const firstAnnounced = items.findIndex((item) => item.status === 'announced')
	const visible =
		dismissed === null
			? items.slice(0, firstAnnounced === -1 ? items.length : firstAnnounced)
			: items.filter((item) => item.status === 'active' || !dismissed.has(item.dismissKey))
	const index = Math.max(
		0,
		visible.findIndex((item) => item.id === selectedId)
	)
	const current = visible[index]
	const active = current?.status === 'active'
	const endsAt = current?.endsAt ?? null

	useEffect(() => {
		setNearEnd(active && endsAt !== null && Date.parse(endsAt) - Date.now() <= countdownThresholdMs)
	}, [active, endsAt, countdownThresholdMs])

	if (!current) {
		return null
	}

	const dismiss = async () => {
		const next = visible[index + 1] ?? visible[index - 1]
		setSelectedId(next?.id ?? null)
		setDismissed((prior) => new Set([...(prior ?? []), current.dismissKey]))
		const seen = (await getPreference<string[]>(PREFERENCE_KEY)) ?? []
		await setPreference(PREFERENCE_KEY, [
			...seen.filter((key) => key !== current.dismissKey),
			current.dismissKey,
		])
	}

	const title = t(active ? keys.bannerActiveTitle : keys.bannerAnnouncedTitle)
	const scope =
		current.scopeLabels === null
			? t(active ? keys.bannerActiveEverything : keys.bannerAnnouncedEverything)
			: t(active ? keys.bannerActivePartial : keys.bannerAnnouncedPartial, {
					what: current.scopeLabels.join(', '),
				})
	const countdown =
		endsAt !== null && nearEnd ? <Countdown endsAt={endsAt} key={current.id} /> : null

	return (
		<div
			className={`${baseClass} ${baseClass}--${current.status}`}
			role={active ? 'alert' : 'status'}
		>
			<div className={`${baseClass}__row`}>
				{current.message ? (
					<div className={`${baseClass}__message`}>
						{current.message}
						{countdown}
					</div>
				) : (
					<>
						<strong className={`${baseClass}__title`}>{title}</strong>
						<span className={`${baseClass}__scope`}>{scope}</span>
						<span className={`${baseClass}__times`}>
							{!active && (
								<span>
									{t(keys.bannerFrom)} <LocalDate iso={current.startsAt} />
								</span>
							)}
							{endsAt !== null && !nearEnd && (
								<span>
									{t(keys.bannerUntil)} <LocalDate iso={endsAt} />
								</span>
							)}
							{countdown}
						</span>
					</>
				)}
				<span className={`${baseClass}__controls`}>
					{visible.length > 1 && (
						<span className={`${baseClass}__pager`}>
							<button
								aria-label={t(keys.bannerPrevious)}
								className={`${baseClass}__button`}
								disabled={index === 0}
								onClick={() => setSelectedId(visible[index - 1]?.id ?? null)}
								type="button"
							>
								<ChevronIcon direction="up" />
							</button>
							<span
								title={t(keys.bannerPosition, {
									current: index + 1,
									total: visible.length,
								})}
								className={`${baseClass}__position`}
							>
								{index + 1}/{visible.length}
							</span>
							<button
								aria-label={t(keys.bannerNext)}
								className={`${baseClass}__button`}
								disabled={index === visible.length - 1}
								onClick={() => setSelectedId(visible[index + 1]?.id ?? null)}
								type="button"
							>
								<ChevronIcon direction="down" />
							</button>
						</span>
					)}
					{!active && (
						<button
							aria-label={t(keys.bannerDismiss)}
							className={`${baseClass}__button ${baseClass}__dismiss`}
							onClick={() => void dismiss()}
							type="button"
						>
							×
						</button>
					)}
				</span>
			</div>
		</div>
	)
}
