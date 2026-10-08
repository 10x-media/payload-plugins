'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'

import { resolveViewer } from '../../shared/resolveViewer'
import { toPreviewFile } from '../../shared/types'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { defaultViewers } from '../../viewers/defaultViewers'
import { InfoCard } from '../../viewers/InfoCard'
import { PreviewLoading } from '../../viewers/ViewerStatus'
import { useViewerOverrides } from '../Provider/DocumentPreviewProvider'
import { PreviewErrorBoundary } from './PreviewErrorBoundary'
import './document-preview.css'

export type DocumentPreviewProps = {
	className?: string
	/** Upload collection slug, for per-collection viewer overrides. */
	collection?: string
	/** The upload document; needs at least `url` and `filename`. Renders nothing without a file. */
	doc: null | Record<string, unknown> | undefined
	/**
	 * Start inert until clicked, so the wheel scrolls the page around the preview
	 * instead of the viewer; a pointer down outside makes it inert again. For
	 * previews embedded in a scrolling page, such as the inline field.
	 */
	interactOnClick?: boolean
}

/** Whether the preview takes input: always without `enabled`, otherwise from a click inside until a pointer down outside. */
const useClickToActivate = (enabled: boolean) => {
	const ref = useRef<HTMLDivElement>(null)
	const [active, setActive] = useState(!enabled)
	useEffect(() => {
		if (!enabled || !active) {
			return
		}
		const onPointerDown = (event: PointerEvent) => {
			if (!ref.current?.contains(event.target as Node)) {
				setActive(false)
			}
		}
		document.addEventListener('pointerdown', onPointerDown)
		return () => document.removeEventListener('pointerdown', onPointerDown)
	}, [active, enabled])
	return { activate: () => setActive(true), active, ref }
}

/**
 * Read-only preview of one upload document. Picks the viewer by mime (host
 * overrides for the collection, then global ones, then the built-ins, then the
 * info card), loads it lazily, and contains any failure to the card. It fills
 * its container, so give the container a height.
 */
export const DocumentPreview = ({
	className,
	collection,
	doc,
	interactOnClick = false,
}: DocumentPreviewProps) => {
	const { t } = useTranslation()
	const file = useMemo(() => toPreviewFile(doc), [doc])
	const { activate, active, ref } = useClickToActivate(interactOnClick)
	const overrides = useViewerOverrides(collection)
	// Viewers touch browser-only APIs (wasm, workers, navigator), so they only ever render on the client.
	const [mounted, setMounted] = useState(false)
	useEffect(() => setMounted(true), [])

	if (!file || !doc) {
		return null
	}
	const Viewer = resolveViewer([...overrides, defaultViewers], file.mimeType)
	const card = (
		<InfoCard
			filename={file.filename}
			filesize={file.filesize}
			mimeType={file.mimeType}
			reason="failed"
		/>
	)
	return (
		<div className={['document-preview', className].filter(Boolean).join(' ')} ref={ref}>
			{!mounted ? (
				<PreviewLoading />
			) : Viewer ? (
				<PreviewErrorBoundary fallback={card} key={file.url}>
					<Suspense fallback={<PreviewLoading />}>
						<Viewer {...file} collection={collection} doc={doc} />
					</Suspense>
				</PreviewErrorBoundary>
			) : (
				<InfoCard filename={file.filename} filesize={file.filesize} mimeType={file.mimeType} />
			)}
			{active || !Viewer ? null : (
				<button className="document-preview__activate" onClick={activate} type="button">
					<span className="document-preview__activate-hint">{t(keys.clickToInteract)}</span>
				</button>
			)}
		</div>
	)
}
