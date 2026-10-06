import { Link, Pill } from '@payloadcms/ui'
import { type CollectionSlug, getCurrentDate, type ServerProps } from 'payload'
import * as qs from 'qs-esm'

import { keys } from '../../translations/keys'
import { asTranslate } from '../../translations/server'
import { LOCK_STAGES, stageLabel, stagePillStyle, stageWhere } from '../stage'

type Props = Pick<ServerProps, 'i18n' | 'payload'> & { slug: string }

/**
 * Quick filters above the lock windows list: one pill per stage with its
 * count, linking to the list filtered to that stage, plus "All". The stage is
 * derived from dates, so each pill carries the query for it at render time.
 * Stages with nothing in them are left out.
 */
export const StageFilterBar = async ({ i18n, payload, slug }: Props) => {
	if (!payload || !i18n) {
		return null
	}
	const now = getCurrentDate()
	const counts = await Promise.all(
		LOCK_STAGES.map(async (stage) => {
			const { totalDocs } = await payload.count({
				collection: slug as CollectionSlug,
				where: stageWhere(stage, now),
			})
			return { stage, count: totalDocs }
		})
	)
	const total = counts.reduce((sum, { count }) => sum + count, 0)
	if (total === 0) {
		return null
	}
	const t = asTranslate(i18n.t)
	const base = `${payload.config.routes.admin}/collections/${slug}`
	return (
		<div
			style={{
				alignItems: 'center',
				display: 'flex',
				flexWrap: 'wrap',
				gap: 'calc(var(--base) / 2)',
				marginBottom: 'var(--base)',
			}}
		>
			<Link href={base} prefetch={false} style={{ textDecoration: 'none' }}>
				<Pill pillStyle="light" size="small">
					{t(keys.filterAll)} <strong>{total}</strong>
				</Pill>
			</Link>
			{counts.map(({ stage, count }) =>
				count === 0 ? null : (
					<Link
						href={`${base}${qs.stringify({ where: stageWhere(stage, now) }, { addQueryPrefix: true })}`}
						key={stage}
						prefetch={false}
						style={{ textDecoration: 'none' }}
					>
						<Pill pillStyle={stagePillStyle[stage]} size="small">
							{t(stageLabel[stage])} <strong>{count}</strong>
						</Pill>
					</Link>
				)
			)}
		</div>
	)
}
