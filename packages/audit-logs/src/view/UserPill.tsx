'use client'

import { Link, Pill, Popup } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import type { ResolvedUser } from './utils'

type Props = {
	adminRoute: string
	impersonator?: ResolvedUser
	user: ResolvedUser
}

/** A deleted user has no page, and a bare id with no known collection has no route. */
const userHref = (adminRoute: string, user: ResolvedUser): string | undefined =>
	user.deleted || !user.slug
		? undefined
		: formatAdminURL({
				adminRoute,
				path: `/collections/${user.slug}/${encodeURIComponent(user.id)}`,
			})

const UserName = ({ adminRoute, user }: { adminRoute: string; user: ResolvedUser }) => {
	const { t } = useTranslation()
	const href = userHref(adminRoute, user)

	if (user.deleted) {
		return (
			<span className="al-user__name al-user__name--deleted" title={user.id}>
				{t(keys.deletedUser)}
			</span>
		)
	}
	return href ? (
		<Link className="al-user__name" href={href} rel="noopener" target="_blank" title={user.label}>
			{user.label}
		</Link>
	) : (
		<span className="al-user__name" title={user.label}>
			{user.label}
		</span>
	)
}

/**
 * Who the entry ran as. Under impersonation the same pill carries a second part
 * that opens who was impersonating, so the row still reads as one subject.
 */
export function UserPill({ adminRoute, impersonator, user }: Props) {
	const { t } = useTranslation()

	return (
		<Pill
			className={`al-user${impersonator ? ' al-user--impersonated' : ''}`}
			pillStyle={user.deleted ? 'light-gray' : 'light'}
			size="small"
		>
			<UserName adminRoute={adminRoute} user={user} />
			{impersonator && (
				<Popup
					button={<span className="al-user__impersonated">{t(keys.impersonated)}</span>}
					buttonClassName="al-user__trigger"
					className="al-user__popup"
					horizontalAlign="left"
					noBackground
					render={() => (
						<div className="al-user__popover">
							<span className="al-user__popover-label">{t(keys.impersonatedBy)}</span>
							{/* Not `to`: Pill renders that link itself and gives it no target. */}
							<Pill pillStyle={impersonator.deleted ? 'light-gray' : 'light'} size="small">
								<UserName adminRoute={adminRoute} user={impersonator} />
							</Pill>
						</div>
					)}
					size="fit-content"
					verticalAlign="bottom"
				/>
			)}
		</Pill>
	)
}
