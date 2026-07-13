import { Link, Pill } from '@payloadcms/ui'
import type { ServerProps } from 'payload'

import { keys } from '../translations/keys'
import { asTranslate } from '../translations/server'
import { type JobStatus, statusWhere } from './deriveJobStatus'
import { JobsTotalChip } from './JobsTotalChip'
import { jobStatusMeta } from './jobStatusMeta'
import { jobsListURL } from './jobsListURL'

const DEFAULT_CAP = 100

/** Display order: succeeded first, then active, pending, and problem states. */
const ORDER: JobStatus[] = [
	'succeeded',
	'running',
	'queued',
	'scheduled',
	'failed',
	'retrying',
	'cancelled',
]

type Props = Pick<ServerProps, 'i18n' | 'payload'> & { cap?: false | number }

/**
 * Queue-health bar above the jobs list: one indexed `count` per status, so it
 * stays cheap on large tables. A count above `cap` renders as `${cap}+`; pass
 * `cap: false` for the exact figure.
 */
export const JobsHealthBar = async ({ cap = DEFAULT_CAP, i18n, payload }: Props) => {
	const now = Date.now()
	const results = await Promise.all(
		ORDER.map(async (status) => {
			const { totalDocs } = await payload.count({
				collection: 'payload-jobs',
				where: statusWhere(status, now),
			})
			return { count: totalDocs, status }
		})
	)

	const total = results.reduce((sum, result) => sum + result.count, 0)
	if (total === 0) {
		return null
	}

	const t = asTranslate(i18n.t)
	const show = (n: number): string => (cap !== false && n > cap ? `${cap}+` : String(n))
	const adminRoute = payload.config.routes?.admin ?? '/admin'

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
			<JobsTotalChip fallbackHref={jobsListURL(adminRoute)}>
				<strong>
					{show(total)} {t(total === 1 ? keys.jobSingular : keys.jobPlural)}
				</strong>
			</JobsTotalChip>
			{results.map(({ count, status }) =>
				count === 0 ? null : (
					<Link
						href={jobsListURL(adminRoute, status, now)}
						key={status}
						prefetch={false}
						style={{ textDecoration: 'none' }}
					>
						<Pill pillStyle={jobStatusMeta[status].pillStyle} size="small">
							{show(count)} {t(jobStatusMeta[status].labelKey)}
						</Pill>
					</Link>
				)
			)}
		</div>
	)
}
