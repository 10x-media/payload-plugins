'use client'

import { type MouseEvent, type PointerEvent, useCallback, useEffect, useRef, useState } from 'react'

import type { DocumentPreviewViewerProps } from '../shared/types'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { InfoCard } from './InfoCard'

type View = { scale: number; x: number; y: number }

type Size = { height: number; width: number }

const MIN_SCALE = 0.05
const MAX_SCALE = 16
const STEP = 1.25

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * Scale and offset that fit the whole image in the stage. Raster images never
 * upscale past 100%, where they would blur; vectors fill the stage.
 */
const fitView = (stage: Size, image: Size, upscale: boolean): View => {
	const contain = Math.min(stage.width / image.width, stage.height / image.height)
	const scale = upscale ? contain : Math.min(contain, 1)
	return {
		scale,
		x: (stage.width - image.width * scale) / 2,
		y: (stage.height - image.height * scale) / 2,
	}
}

/** `view` rescaled to `scale` around the stage point (`px`, `py`), which stays put on screen. */
const zoomAround = (view: View, scale: number, [px, py]: [number, number]): View => {
	const next = clamp(scale, MIN_SCALE, MAX_SCALE)
	const ratio = next / view.scale
	return { scale: next, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio }
}

/**
 * Image viewer with wheel and button zoom around the pointer, drag to pan, and
 * fit / 100% shortcuts (double click toggles between them). Fit tracks stage
 * resizes until the user zooms or pans. SVG renders through `<img>`, so its
 * scripts never run. The image is sized to its natural pixels explicitly: an
 * SVG with only a `viewBox` otherwise stretches to the stage and the transform
 * math no longer matches what is on screen.
 */
export const ImageViewer = ({ filename, filesize, mimeType, url }: DocumentPreviewViewerProps) => {
	const { t } = useTranslation()
	const stageRef = useRef<HTMLDivElement>(null)
	const [natural, setNatural] = useState<null | Size>(null)
	const [view, setView] = useState<null | View>(null)
	const [fitted, setFitted] = useState(true)
	const [failed, setFailed] = useState(false)
	const [drag, setDrag] = useState<null | { pointerId: number; x: number; y: number }>(null)
	const isVector = mimeType === 'image/svg+xml'

	const stageSize = (): Size | undefined => {
		const rect = stageRef.current?.getBoundingClientRect()
		return rect ? { height: rect.height, width: rect.width } : undefined
	}

	const fit = useCallback(() => {
		const stage = stageRef.current?.getBoundingClientRect()
		if (!stage || !natural) {
			return
		}
		setView(fitView(stage, natural, isVector))
		setFitted(true)
	}, [isVector, natural])

	useEffect(() => {
		const stage = stageRef.current
		if (!stage || !fitted) {
			return
		}
		fit()
		const observer = new ResizeObserver(() => fit())
		observer.observe(stage)
		return () => observer.disconnect()
	}, [fit, fitted])

	/** Zoom to `scale(current)` around a stage point, defaulting to the stage center. */
	const zoomTo = useCallback((scale: (current: number) => number, px?: number, py?: number) => {
		const rect = stageRef.current?.getBoundingClientRect()
		if (!rect) {
			return
		}
		setView((current) =>
			current
				? zoomAround(current, scale(current.scale), [px ?? rect.width / 2, py ?? rect.height / 2])
				: current
		)
		setFitted(false)
	}, [])

	// React registers wheel listeners as passive, and the zoom must stop the drawer from scrolling.
	useEffect(() => {
		const stage = stageRef.current
		if (!stage) {
			return
		}
		const onWheel = (event: WheelEvent) => {
			event.preventDefault()
			const rect = stage.getBoundingClientRect()
			const factor = Math.exp(-event.deltaY * 0.002)
			zoomTo((scale) => scale * factor, event.clientX - rect.left, event.clientY - rect.top)
		}
		stage.addEventListener('wheel', onWheel, { passive: false })
		return () => stage.removeEventListener('wheel', onWheel)
	}, [zoomTo])

	const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) {
			return
		}
		event.currentTarget.setPointerCapture(event.pointerId)
		setDrag({ pointerId: event.pointerId, x: event.clientX, y: event.clientY })
	}

	const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
		if (!drag || drag.pointerId !== event.pointerId) {
			return
		}
		const dx = event.clientX - drag.x
		const dy = event.clientY - drag.y
		setDrag({ ...drag, x: event.clientX, y: event.clientY })
		setView((current) => (current ? { ...current, x: current.x + dx, y: current.y + dy } : current))
		setFitted(false)
	}

	const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
		if (drag?.pointerId === event.pointerId) {
			setDrag(null)
		}
	}

	const onDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
		const rect = event.currentTarget.getBoundingClientRect()
		if (fitted) {
			zoomTo(() => 1, event.clientX - rect.left, event.clientY - rect.top)
		} else {
			fit()
		}
	}

	if (failed) {
		return <InfoCard filename={filename} filesize={filesize} mimeType={mimeType} reason="failed" />
	}

	return (
		<div className="document-preview-image">
			{/* biome-ignore lint/a11y/noStaticElementInteractions: pointer-only pan and zoom surface; the toolbar carries the keyboard equivalents */}
			<div
				className="document-preview-image__stage"
				data-dragging={drag ? 'true' : undefined}
				onDoubleClick={onDoubleClick}
				onPointerCancel={onPointerUp}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				ref={stageRef}
			>
				<img
					alt={filename}
					className="document-preview-image__img"
					draggable={false}
					onError={() => setFailed(true)}
					onLoad={(event) => {
						const img = event.currentTarget
						const stage = stageSize()
						// An SVG without width/height attributes reports no natural size; fill the stage instead.
						setNatural({
							height: img.naturalHeight || stage?.height || 1,
							width: img.naturalWidth || stage?.width || 1,
						})
					}}
					src={url}
					style={
						view && natural
							? {
									height: natural.height,
									transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
									width: natural.width,
								}
							: { visibility: 'hidden' }
					}
				/>
			</div>
			<div className="document-preview-toolbar">
				<button
					aria-label={t(keys.zoomOut)}
					className="document-preview-toolbar__button"
					onClick={() => zoomTo((scale) => scale / STEP)}
					title={t(keys.zoomOut)}
					type="button"
				>
					−
				</button>
				<span className="document-preview-toolbar__value">
					{view ? `${Math.round(view.scale * 100)}%` : ''}
				</span>
				<button
					aria-label={t(keys.zoomIn)}
					className="document-preview-toolbar__button"
					onClick={() => zoomTo((scale) => scale * STEP)}
					title={t(keys.zoomIn)}
					type="button"
				>
					+
				</button>
				<button
					aria-pressed={fitted}
					className="document-preview-toolbar__button document-preview-toolbar__button--text"
					onClick={fit}
					type="button"
				>
					{t(keys.fitToView)}
				</button>
				<button
					className="document-preview-toolbar__button document-preview-toolbar__button--text"
					onClick={() => zoomTo(() => 1)}
					type="button"
				>
					{t(keys.actualSize)}
				</button>
			</div>
		</div>
	)
}
