// biome-ignore-all lint/suspicious/noExplicitAny: This is copied from the core Payload repo, 1:1
'use client'

import { DraggableSortable, DraggableSortableItem, DragHandleIcon } from '@payloadcms/ui'
import type { JsonObject } from 'payload'
import { getBestFitFromSizes, isImage } from 'payload/shared'
import React from 'react'
import { RelationshipContent } from '../RelationshipContent/index'
import type { ReloadDoc } from '../types'
import { UploadCard } from '../UploadCard/index'
import './index.scss'

const baseClass = 'upload upload--has-many'

type Props = {
	readonly className?: string
	readonly displayPreview?: boolean
	readonly fileDocs: {
		relationTo: string
		value: JsonObject
	}[]
	readonly isSortable?: boolean
	readonly onRemove?: (value: any) => void
	readonly onReorder?: (value: any) => void
	readonly readonly?: boolean
	readonly reloadDoc: ReloadDoc
	readonly serverURL: string
	readonly showCollectionSlug?: boolean
}

export function UploadComponentHasMany(props: Props) {
	const {
		className,
		displayPreview,
		fileDocs,
		isSortable,
		onRemove,
		onReorder,
		readonly,
		reloadDoc,
		serverURL,
		showCollectionSlug = false,
	} = props

	const moveRow = React.useCallback(
		(moveFromIndex: number, moveToIndex: number) => {
			if (moveFromIndex === moveToIndex) return
			const updatedArray = [...fileDocs]
			const [item] = updatedArray.splice(moveFromIndex, 1)
			updatedArray.splice(moveToIndex, 0, item as { relationTo: string; value: JsonObject })
			onReorder?.(updatedArray)
		},
		[fileDocs, onReorder]
	)

	const removeItem = React.useCallback(
		(index: number) => {
			const updatedArray = [...(fileDocs || [])]
			updatedArray.splice(index, 1)
			onRemove?.(updatedArray.length === 0 ? [] : updatedArray)
		},
		[fileDocs, onRemove]
	)

	return (
		<div className={[baseClass, className].filter(Boolean).join(' ')}>
			<DraggableSortable
				className={`${baseClass}__draggable-rows`}
				ids={fileDocs?.map(({ value }) => String(value.id))}
				onDragEnd={({ moveFromIndex, moveToIndex }) => moveRow(moveFromIndex, moveToIndex)}
			>
				{fileDocs.map(({ relationTo, value }, index) => {
					const id = String(value.id)
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
							sizes: value.sizes as any,
							thumbnailURL: thumbnailSrc,
							url: src,
							width: value.width as number,
						})
					}

					return (
						<DraggableSortableItem disabled={!isSortable || readonly} id={id} key={id}>
							{(draggableSortableItemProps) => (
								<div
									className={[
										`${baseClass}__dragItem`,
										draggableSortableItemProps && isSortable && `${baseClass}--has-drag-handle`,
									]
										.filter(Boolean)
										.join(' ')}
									ref={draggableSortableItemProps.setNodeRef}
									style={{
										transform: draggableSortableItemProps.transform,
										transition: draggableSortableItemProps.transition,
										zIndex: draggableSortableItemProps.isDragging ? 1 : undefined,
									}}
								>
									<UploadCard size="small">
										{draggableSortableItemProps && (
											<div
												className={`${baseClass}__drag`}
												{...draggableSortableItemProps.attributes}
												{...draggableSortableItemProps.listeners}
											>
												<DragHandleIcon />
											</div>
										)}
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
											onRemove={() => removeItem(index)}
											reloadDoc={reloadDoc}
											showCollectionSlug={showCollectionSlug}
											src={src}
											thumbnailSrc={thumbnailSrc}
											updatedAt={value.updatedAt as string}
											withMeta={false}
											x={value?.width as number}
											y={value?.height as number}
										/>
									</UploadCard>
								</div>
							)}
						</DraggableSortableItem>
					)
				})}
			</DraggableSortable>
		</div>
	)
}
