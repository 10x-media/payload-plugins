'use client'

import { Banner, Button } from '@payloadcms/ui'
import { useCallback, useEffect, useId, useState } from 'react'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { requestJson } from '../../ui/data/request'
import {
	type ExclusionResponse,
	type ExclusionSite,
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
	| { kind: 'loading' }
	| { kind: 'failed' }
	| { kind: 'ready'; link: ExclusionResponse }

type CopyLabel = typeof keys.viewExclusionCopy | typeof keys.viewExclusionShare

const COPIED_MS = 2000
const RESUME_TOKEN = '0'

/** The sites the install names, else the admin's own address when the server knows the site runs there. */
const sitesOf = (link: ExclusionResponse): ExclusionSite[] => {
	if (link.sites.length > 0) {
		return link.sites
	}
	return link.sameOrigin === true
		? [{ address: `${window.location.origin}/`, token: link.token }]
		: []
}

/**
 * Copies one value. Payload's `CopyToClipboard` names its button only through a tooltip that
 * stays hidden until hover, which leaves the button nameless at rest.
 */
function CopyButton({
	value,
	label,
	describedBy,
	size,
}: {
	value: string
	label: CopyLabel
	describedBy: string
	size: 'medium' | 'large'
}) {
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
				// Browsers offer no clipboard outside a secure context.
				const clipboard: Clipboard | undefined = navigator.clipboard
				clipboard?.writeText(value).then(
					() => setCopied(true),
					() => setCopied(false)
				)
			}}
			size={size}
		>
			{t(copied ? 'general:copied' : label)}
		</Button>
	)
}

/**
 * Where the admin knows the site's address, one row per site whose links open it in a new tab,
 * where its own tracker stores or clears the flag; elsewhere the part to add to the address.
 */
export function ExcludeBrowser({ endpoint }: ExcludeBrowserProps) {
	const { t } = useTranslation()
	const id = useId()
	const [state, setState] = useState<LinkState>({ kind: 'loading' })

	const load = useCallback(() => {
		setState({ kind: 'loading' })
		requestJson(endpoint)
			.then((body) => {
				const link = readExclusionResponse(body)
				setState(link ? { kind: 'ready', link } : { kind: 'failed' })
			})
			.catch(() => setState({ kind: 'failed' }))
	}, [endpoint])

	useEffect(() => {
		load()
	}, [load])

	const titleId = `${id}-title`

	const field = (value: string, label: string, index: number) => {
		const labelId = `${id}-label-${index}`
		const inputId = `${id}-link-${index}`
		return (
			<>
				<label className="analytics-view__field-label" htmlFor={inputId} id={labelId}>
					{label}
				</label>
				<div className="analytics-view__exclusion-link">
					<input
						className="analytics-view__exclusion-input"
						dir="ltr"
						id={inputId}
						onFocus={(event) => event.currentTarget.select()}
						readOnly
						value={value}
					/>
					<CopyButton
						describedBy={labelId}
						label={keys.viewExclusionCopy}
						size="large"
						value={value}
					/>
				</div>
			</>
		)
	}

	const siteRow = (param: string, site: ExclusionSite, index: number) => {
		const { address } = site
		const url = exclusionUrl(address, { param, token: site.token })
		const nameId = `${id}-site-${index}`
		return (
			<li className="analytics-view__exclusion-site" key={address}>
				<span className="analytics-view__exclusion-name" dir="ltr" id={nameId}>
					{siteName(address)}
				</span>
				<div className="analytics-view__exclusion-actions">
					<Button
						buttonStyle="primary"
						el="anchor"
						extraButtonProps={{ 'aria-describedby': nameId }}
						margin={false}
						newTab
						size="medium"
						url={url}
					>
						{t(keys.viewExclusionExclude)}
					</Button>
					<CopyButton
						describedBy={nameId}
						label={keys.viewExclusionShare}
						size="medium"
						value={url}
					/>
					<a
						aria-describedby={nameId}
						className="analytics-view__exclusion-alt"
						href={exclusionUrl(address, { param, token: RESUME_TOKEN })}
						rel="noopener noreferrer"
						target="_blank"
					>
						{t(keys.viewExclusionInclude)}
					</a>
				</div>
			</li>
		)
	}

	const links = (link: ExclusionResponse) => {
		const sites = sitesOf(link)
		if (sites.length > 0) {
			return (
				<>
					<ul className="analytics-view__exclusion-sites">
						{sites.map((site, index) => siteRow(link.param, site, index))}
					</ul>
					<span className="analytics-view__caption">{t(keys.viewExclusionSitesHelp)}</span>
				</>
			)
		}
		return (
			<>
				{field(exclusionQuery(link), t(keys.viewExclusionLinkLabel), 0)}
				<span className="analytics-view__caption">{t(keys.viewExclusionQueryHelp)}</span>
				{field(
					exclusionQuery({ param: link.param, token: RESUME_TOKEN }),
					t(keys.viewExclusionUndoLabel),
					1
				)}
			</>
		)
	}

	return (
		<section
			aria-labelledby={titleId}
			className="analytics-card analytics-view__panel analytics-view__exclusion"
		>
			<h2 className="analytics-view__label analytics-view__heading" id={titleId}>
				{t(keys.viewExclusionTitle)}
			</h2>
			<span className="analytics-view__exclusion-text">{t(keys.viewExclusionIntro)}</span>
			{state.kind === 'ready' ? links(state.link) : null}
			{state.kind === 'failed' ? (
				<>
					<Banner type="error">{t(keys.viewExclusionFailed)}</Banner>
					<Button buttonStyle="secondary" onClick={load} size="small">
						{t(keys.viewRetry)}
					</Button>
				</>
			) : null}
		</section>
	)
}
