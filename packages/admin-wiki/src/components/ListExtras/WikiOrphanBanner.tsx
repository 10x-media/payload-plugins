'use client'

import { useConfig } from '@payloadcms/ui'
import { useEffect, useState } from 'react'

import type { WikiOrphanedGuide, WikiOrphansResponse } from '../../shared/orphanedTargets'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { useWikiTargets } from '../WikiProvider/WikiProvider'
import './list-extras.css'

/**
 * Warning banner above the wiki pages list for users with update access:
 * guides whose stored targets no longer resolve against the running config,
 * each linking straight to its edit view.
 */
export const WikiOrphanBanner = () => {
	const { t } = useTranslation()
	const { config } = useConfig()
	const { canUpdate, pagesSlug } = useWikiTargets()
	const [orphans, setOrphans] = useState<WikiOrphanedGuide[]>([])

	useEffect(() => {
		if (!canUpdate) {
			return
		}
		let cancelled = false
		const base = `${config.serverURL ?? ''}${config.routes.api}`
		void fetch(`${base}/${pagesSlug}/orphaned-targets`, { credentials: 'include' })
			.then((response) => (response.ok ? (response.json() as Promise<WikiOrphansResponse>) : null))
			.then((body) => {
				if (!cancelled && body) {
					setOrphans(body.orphans)
				}
			})
			.catch(() => {})
		return () => {
			cancelled = true
		}
	}, [canUpdate, config.routes.api, config.serverURL, pagesSlug])

	if (orphans.length === 0) {
		return null
	}

	return (
		<div className="wiki-orphan-banner">
			<p className="wiki-orphan-banner__heading">{t(keys.orphanedHeading)}</p>
			<p className="wiki-orphan-banner__intro">{t(keys.orphanedIntro)}</p>
			<ul className="wiki-orphan-banner__list">
				{orphans.map((orphan) => (
					<li className="wiki-orphan-banner__item" key={orphan.id}>
						<a
							className="wiki-orphan-banner__link"
							href={`${config.routes.admin}/collections/${pagesSlug}/${orphan.id}`}
						>
							{orphan.title ?? orphan.slug ?? orphan.id}
						</a>
						{orphan.orphanedKeys.map((key) => (
							<code className="wiki-orphan-banner__key" key={key}>
								{key}
							</code>
						))}
					</li>
				))}
			</ul>
		</div>
	)
}
