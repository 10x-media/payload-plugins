'use client'

import { Button, EditIcon, ExternalLinkIcon } from '@payloadcms/ui'

export type ImpersonationUserCardProps = {
	collectionSlug: string
	doc: Record<string, unknown>
	documentHref: string
	email?: string
	onOpenDrawer: () => void
	onSelect: () => void
	openDocumentLabel: string
	openDrawerLabel: string
	title: string
}

/**
 * Default switcher row. Title is `admin.useAsTitle`. Email is optional and
 * omitted when it would duplicate the title. Hosts can copy this for a custom
 * card (roles, avatars) built with `useImpersonation`.
 */
export const ImpersonationUserCard = ({
	collectionSlug,
	doc,
	documentHref,
	email,
	onOpenDrawer,
	onSelect,
	openDocumentLabel,
	openDrawerLabel,
	title,
}: ImpersonationUserCardProps) => (
	<div
		className="impersonation-card"
		data-collection={collectionSlug}
		data-id={String(doc.id ?? '')}
	>
		<button className="impersonation-card__pick" onClick={onSelect} type="button">
			<span className="impersonation-card__title">{title}</span>
			{email ? (
				<span aria-hidden="true" className="impersonation-card__email">
					{email}
				</span>
			) : null}
		</button>
		<div className="impersonation-card__actions">
			<Button
				aria-label={openDrawerLabel}
				buttonStyle="icon-label"
				extraButtonProps={{ 'data-testid': 'impersonation-open-drawer' }}
				icon={<EditIcon />}
				iconStyle="none"
				margin={false}
				onClick={onOpenDrawer}
				size="small"
				tooltip={openDrawerLabel}
			/>
			<Button
				aria-label={openDocumentLabel}
				buttonStyle="icon-label"
				el="link"
				extraButtonProps={{ 'data-testid': 'impersonation-open-document' }}
				icon={<ExternalLinkIcon />}
				iconStyle="none"
				margin={false}
				size="small"
				to={documentHref}
				tooltip={openDocumentLabel}
			/>
		</div>
	</div>
)
