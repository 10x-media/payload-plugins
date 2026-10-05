'use client'

import { Drawer, useModal } from '@payloadcms/ui'

import { DocumentPreview } from '../DocumentPreview/DocumentPreview'
import './preview-drawer.css'

export type PreviewDrawerProps = {
	collection?: string
	doc: null | Record<string, unknown> | undefined
	/** Modal slug from `useDrawerSlug`; open it with `useModal().openModal(slug)`. */
	slug: string
	title: string
}

/**
 * A Payload drawer holding one document's preview. The preview only mounts
 * while the drawer is open, so a closed drawer never loads a viewer.
 */
export const PreviewDrawer = ({ collection, doc, slug, title }: PreviewDrawerProps) => {
	const { modalState } = useModal()
	const isOpen = Boolean(modalState?.[slug]?.isOpen)
	return (
		<Drawer className="document-preview-drawer" slug={slug} title={title}>
			{isOpen ? (
				<DocumentPreview
					className="document-preview-drawer__preview"
					collection={collection}
					doc={doc}
				/>
			) : null}
		</Drawer>
	)
}
