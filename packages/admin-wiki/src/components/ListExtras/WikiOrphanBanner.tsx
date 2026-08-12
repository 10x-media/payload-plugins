'use client'

import { Banner, Pill, useConfig } from '@payloadcms/ui'
import { useEffect, useState } from 'react'

import type { WikiOrphanedGuide, WikiOrphansResponse } from '../../shared/orphanedTargets'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { CalloutIcon } from '../icons'
import { useWikiTargets } from '../WikiProvider/WikiProvider'
import './list-extras.css'

/**
 * Banner above the wiki pages table for users with update access: guides whose
 * stored targets no longer resolve against the running config, each linking
 * straight to its edit view so the target can be reassigned.
 *
 * Payload's own `Banner` in its error style, because a guide pointing at a field
 * that no longer exists is help nobody will ever see.
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
		<Banner
			alignIcon="left"
			className="wiki-orphan-banner"
			icon={<CalloutIcon variant="warning" />}
			type="error"
		>
			<span className="wiki-orphan-banner__body">
				<span className="wiki-orphan-banner__heading">{t(keys.orphanedHeading)}</span>
				<span className="wiki-orphan-banner__intro">{t(keys.orphanedIntro)}</span>
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
								<Pill className="wiki-orphan-banner__key" key={key} pillStyle="error" size="small">
									{key}
								</Pill>
							))}
						</li>
					))}
				</ul>
			</span>
		</Banner>
	)
}
