'use client'

import './banner.css'

import { usePreferences } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { formatCountdown } from './formatDate'
import { LocalDate } from './LocalDate'

const PREFERENCE_KEY = 'content-lock-dismissed'
const baseClass = 'content-lock-banner'

export type ContentLockBannerProps = {
	status: 'announced' | 'active'
	/** Labels of what the window freezes, or `null` for everything. */
	scopeLabels: string[] | null
	startsAt: string
	/** This window's known end, or `null` when it ends manually. */
	endsAt: string | null
	countdownThresholdMs: number
	/** Identity of the announcement; changes when the window is rescheduled. */
	dismissKey: string
	/** The window's rendered message, if it has one. */
	children?: ReactNode
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
 * The admin-wide notice for one lock window. Announcements can be dismissed
 * per user (stored in preferences, so it follows them across devices); an
 * active lock cannot.
 */
export const ContentLockBanner = ({
	status,
	scopeLabels,
	startsAt,
	endsAt,
	countdownThresholdMs,
	dismissKey,
	children,
}: ContentLockBannerProps) => {
	const { t } = useTranslation()
	const { getPreference, setPreference } = usePreferences()
	const active = status === 'active'
	// Announcements stay hidden until the preference is known, so a dismissed one never flashes.
	const [dismissed, setDismissed] = useState<boolean | null>(active ? false : null)
	const [nearEnd, setNearEnd] = useState(false)

	useEffect(() => {
		if (active) {
			return
		}
		let cancelled = false
		void getPreference<string[]>(PREFERENCE_KEY).then((keysSeen) => {
			if (!cancelled) {
				setDismissed(Array.isArray(keysSeen) && keysSeen.includes(dismissKey))
			}
		})
		return () => {
			cancelled = true
		}
	}, [active, dismissKey, getPreference])

	useEffect(() => {
		setNearEnd(active && endsAt !== null && Date.parse(endsAt) - Date.now() <= countdownThresholdMs)
	}, [active, endsAt, countdownThresholdMs])

	if (dismissed !== false) {
		return null
	}

	const dismiss = async () => {
		setDismissed(true)
		const seen = (await getPreference<string[]>(PREFERENCE_KEY)) ?? []
		await setPreference(PREFERENCE_KEY, [...seen.filter((key) => key !== dismissKey), dismissKey])
	}

	const title = t(active ? keys.bannerActiveTitle : keys.bannerAnnouncedTitle)
	const scope =
		scopeLabels === null
			? t(active ? keys.bannerActiveEverything : keys.bannerAnnouncedEverything)
			: t(active ? keys.bannerActivePartial : keys.bannerAnnouncedPartial, {
					what: scopeLabels.join(', '),
				})

	return (
		<div className={`${baseClass} ${baseClass}--${status}`} role={active ? 'alert' : 'status'}>
			<div className={`${baseClass}__row`}>
				<strong className={`${baseClass}__title`}>{title}</strong>
				<span className={`${baseClass}__scope`}>{scope}</span>
				<span className={`${baseClass}__times`}>
					{!active && (
						<span>
							{t(keys.bannerFrom)} <LocalDate iso={startsAt} />
						</span>
					)}
					{endsAt !== null && !nearEnd && (
						<span>
							{t(keys.bannerUntil)} <LocalDate iso={endsAt} />
						</span>
					)}
					{endsAt !== null && nearEnd && <Countdown endsAt={endsAt} />}
				</span>
				{!active && (
					<button
						aria-label={t(keys.bannerDismiss)}
						className={`${baseClass}__dismiss`}
						onClick={() => void dismiss()}
						type="button"
					>
						×
					</button>
				)}
			</div>
			{children ? <div className={`${baseClass}__message`}>{children}</div> : null}
		</div>
	)
}
