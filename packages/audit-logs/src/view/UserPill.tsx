'use client'

import { ChevronIcon, Link, Pill, Popup } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import type { ReactNode } from 'react'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import type { ResolvedUser } from './utils'

type Props = {
	adminRoute: string
	impersonator?: ResolvedUser
	/** The host's `view.components.user`, shown in the pill's popover. */
	popover?: ReactNode
	user: ResolvedUser
}

/** A deleted user has no page. */
const userHref = (adminRoute: string, user: ResolvedUser): string | undefined =>
	user.deleted
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

/** One segment of the pill that opens a popover below it. */
const PillPopup = ({ button, children }: { button: ReactNode; children: ReactNode }) => (
	<Popup
		button={button}
		buttonClassName="al-user__trigger"
		className="al-user__popup"
		horizontalAlign="left"
		noBackground
		render={() => <div className="al-user__popover">{children}</div>}
		size="fit-content"
		verticalAlign="bottom"
	/>
)

/**
 * Who the entry ran as. Under impersonation the same pill carries a second part
 * that opens who was impersonating, so the row still reads as one subject. A host
 * `user` slot adds a chevron segment of its own, after that mark, so neither hides
 * the other.
 */
export function UserPill({ adminRoute, impersonator, popover, user }: Props) {
	const { t } = useTranslation()
	const segmented = Boolean(impersonator) || popover != null

	return (
		<Pill
			className={`al-user${segmented ? ' al-user--segmented' : ''}`}
			pillStyle={user.deleted ? 'light-gray' : 'light'}
			size="small"
		>
			<UserName adminRoute={adminRoute} user={user} />
			{impersonator && (
				<PillPopup button={<span className="al-user__impersonated">{t(keys.impersonated)}</span>}>
					<span className="al-user__popover-label">{t(keys.impersonatedBy)}</span>
					{/* Not `to`: Pill renders that link itself and gives it no target. */}
					<Pill pillStyle={impersonator.deleted ? 'light-gray' : 'light'} size="small">
						<UserName adminRoute={adminRoute} user={impersonator} />
					</Pill>
				</PillPopup>
			)}
			{popover != null && (
				<PillPopup
					button={
						<span className="al-user__more" title={t(keys.aboutUser)}>
							<ChevronIcon direction="down" />
							<span className="al-visually-hidden">{t(keys.aboutUser)}</span>
						</span>
					}
				>
					{popover}
				</PillPopup>
			)}
		</Pill>
	)
}
