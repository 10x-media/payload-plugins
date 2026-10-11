'use client'

import { Banner, Button, CheckboxInput } from '@payloadcms/ui'
import {
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react'
import { readExclusion, subscribeExclusion, writeExclusion } from '../../tracker/exclusion'
import { liveTracker } from '../../tracker/registry'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { requestJson } from '../../ui/data/request'
import {
	type ExclusionResponse,
	exclusionQuery,
	exclusionUrl,
	readExclusionResponse,
	siteName,
} from '../exclusionLink'

export interface ExcludeBrowserProps {
	/** The exclusion endpoint, under the app's `routes.api`. */
	endpoint: string
}

type LinkState =
	| { kind: 'idle' }
	| { kind: 'loading' }
	| { kind: 'failed' }
	| { kind: 'ready'; link: ExclusionResponse }

const flagSnapshot = (): boolean => readExclusion(window)

const serverSnapshot = (): boolean => false

/**
 * Through a tracker running in this window when there is one, which also sets the vendors'
 * own switches; otherwise the flag alone, which the site's tracker reads on its next page.
 */
const setExcluded = (next: boolean): void => {
	const tracker = liveTracker(window)
	if (tracker) {
		tracker.exclude(next)
		return
	}
	writeExclusion(window, next)
}

const COPIED_MS = 2000

/**
 * Copies one link, in Payload's own words. Payload's `CopyToClipboard` names its button only
 * through a tooltip that stays hidden until hover, which leaves the button nameless at rest.
 */
function CopyButton({ value, describedBy }: { value: string; describedBy: string }) {
	const { t } = useTranslation()
	const [copied, setCopied] = useState(false)
	useEffect(() => {
		if (!copied) {
			return
		}
		const timer = setTimeout(() => setCopied(false), COPIED_MS)
		return () => clearTimeout(timer)
	}, [copied])
	return (
		<Button
			buttonStyle="secondary"
			extraButtonProps={{ 'aria-describedby': describedBy }}
			margin={false}
			onClick={() => {
				// Browsers offer no clipboard outside a secure context; the field stays there to select.
				const clipboard: Clipboard | undefined = navigator.clipboard
				clipboard?.writeText(value).then(
					() => setCopied(true),
					() => setCopied(false)
				)
			}}
			size="medium"
		>
			{t(copied ? 'general:copied' : 'general:copy')}
		</Button>
	)
}

/**
 * Exclusion link for the reader's own scope, fetched on demand, plus a switch for this browser
 * unless the admin is known to run elsewhere than the site.
 */
export function ExcludeBrowser({ endpoint }: ExcludeBrowserProps) {
	const { t } = useTranslation()
	const id = useId()
	const [state, setState] = useState<LinkState>({ kind: 'idle' })
	const excluded = useSyncExternalStore(subscribeExclusion, flagSnapshot, serverSnapshot)
	const firstLink = useRef<HTMLInputElement>(null)
	const asked = useRef(false)

	const load = useCallback(() => {
		asked.current = true
		setState({ kind: 'loading' })
		requestJson(endpoint)
			.then((body) => {
				const link = readExclusionResponse(body)
				setState(link ? { kind: 'ready', link } : { kind: 'failed' })
			})
			.catch(() => setState({ kind: 'failed' }))
	}, [endpoint])

	useEffect(() => {
		if (state.kind === 'ready' && asked.current) {
			asked.current = false
			firstLink.current?.focus()
		}
	}, [state])

	const titleId = `${id}-title`
	const labelId = (index: number): string => `${id}-label-${index}`

	const field = (
		{ value, label, index }: { value: string; label: string; index: number },
		actions: ReactNode
	) => (
		<>
			<label
				className="analytics-view__field-label"
				htmlFor={`${id}-link-${index}`}
				id={labelId(index)}
			>
				{label}
			</label>
			<div className="analytics-view__exclusion-link">
				<input
					className="analytics-view__exclusion-input"
					dir="ltr"
					id={`${id}-link-${index}`}
					onFocus={(event) => event.currentTarget.select()}
					readOnly
					{...(index === 0 ? { ref: firstLink } : {})}
					value={value}
				/>
				{actions}
			</div>
		</>
	)

	const links = (link: ExclusionResponse) =>
		link.sites.length === 0 ? (
			<>
				{field(
					{ value: exclusionQuery(link), label: t(keys.viewExclusionLinkLabel), index: 0 },
					<CopyButton describedBy={labelId(0)} value={exclusionQuery(link)} />
				)}
				<span className="analytics-view__caption">{t(keys.viewExclusionQueryHelp)}</span>
			</>
		) : (
			<>
				<ul className="analytics-view__exclusion-sites">
					{link.sites.map((site, index) => {
						const url = exclusionUrl(site, link)
						const name = siteName(site)
						return (
							<li key={site}>
								{field(
									{ value: url, label: t(keys.viewExclusionLinkFor, { site: name }), index },
									<>
										<CopyButton describedBy={labelId(index)} value={url} />
										<Button
											buttonStyle="secondary"
											el="anchor"
											extraButtonProps={{ 'aria-describedby': labelId(index) }}
											margin={false}
											newTab
											size="medium"
											url={url}
										>
											{t(keys.viewExclusionOpen)}
										</Button>
									</>
								)}
							</li>
						)
					})}
				</ul>
				<span className="analytics-view__caption">{t(keys.viewExclusionSitesHelp)}</span>
			</>
		)

	return (
		<section
			aria-labelledby={titleId}
			className="analytics-card analytics-view__panel analytics-view__exclusion"
		>
			<h2 className="analytics-view__label analytics-view__heading" id={titleId}>
				{t(keys.viewExclusionTitle)}
			</h2>
			<span className="analytics-view__exclusion-text">{t(keys.viewExclusionIntro)}</span>
			{state.kind === 'ready' ? (
				<>
					{links(state.link)}
					{state.link.sameOrigin === false ? null : (
						<>
							<CheckboxInput
								checked={excluded}
								id={`${id}-toggle`}
								label={t(keys.viewExclusionToggle)}
								onToggle={() => setExcluded(!excluded)}
							/>
							{state.link.sameOrigin === null ? (
								<span className="analytics-view__caption">{t(keys.viewExclusionToggleCaveat)}</span>
							) : null}
						</>
					)}
				</>
			) : (
				<Button
					buttonStyle="secondary"
					disabled={state.kind === 'loading'}
					onClick={load}
					size="small"
				>
					{t(keys.viewExclusionShow)}
				</Button>
			)}
			{state.kind === 'failed' ? <Banner type="error">{t(keys.viewExclusionFailed)}</Banner> : null}
		</section>
	)
}
