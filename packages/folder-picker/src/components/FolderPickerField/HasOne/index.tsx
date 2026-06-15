'use client'

import type { JsonObject } from 'payload'

import { getBestFitFromSizes, isImage } from 'payload/shared'
import { RelationshipContent } from '../RelationshipContent/index'
import type { ReloadDoc } from '../types'
import { UploadCard } from '../UploadCard/index'
import './index.scss'

const baseClass = 'upload upload--has-one'

type Props = {
	readonly className?: string
	readonly displayPreview?: boolean
	readonly fileDoc: {
		relationTo: string
		value: JsonObject
	}
	readonly onRemove?: () => void
	readonly readonly?: boolean
	readonly reloadDoc: ReloadDoc
	readonly serverURL: string
	readonly showCollectionSlug?: boolean
}

export function UploadComponentHasOne(props: Props) {
	const {
		className,
		displayPreview,
		fileDoc,
		onRemove,
		readonly,
		reloadDoc,
		serverURL,
		showCollectionSlug = false,
	} = props
	const { relationTo, value } = fileDoc
	const id = String(value?.id)

	let src!: string
	let thumbnailSrc!: string

	if (value.url) {
		try {
			src = new URL(value.url as string, serverURL).toString()
		} catch {
			src = `${serverURL}${value.url}`
		}
	}

	if (value.thumbnailURL) {
		try {
			thumbnailSrc = new URL(value.thumbnailURL as string, serverURL).toString()
		} catch {
			thumbnailSrc = `${serverURL}${value.thumbnailURL}`
		}
	}

	if (isImage(value.mimeType as string)) {
		thumbnailSrc = getBestFitFromSizes({
			// biome-ignore lint/suspicious/noExplicitAny: Not sure
			sizes: value.sizes as any,
			thumbnailURL: thumbnailSrc,
			url: src,
			width: value.width as number,
		})
	}

	return (
		<UploadCard className={[baseClass, className].filter(Boolean).join(' ')}>
			<RelationshipContent
				allowEdit={!readonly}
				allowRemove={!readonly}
				alt={(value?.alt || value?.filename) as string}
				byteSize={value.filesize as number}
				collectionSlug={relationTo}
				displayPreview={displayPreview}
				filename={value.filename as string}
				id={id}
				mimeType={value?.mimeType as string}
				onRemove={onRemove as () => void}
				reloadDoc={reloadDoc}
				showCollectionSlug={showCollectionSlug}
				src={src}
				thumbnailSrc={thumbnailSrc}
				updatedAt={value.updatedAt as string}
				x={value?.width as number}
				y={value?.height as number}
			/>
		</UploadCard>
	)
}
