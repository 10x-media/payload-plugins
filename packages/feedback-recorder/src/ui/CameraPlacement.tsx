'use client'

import { createPortal } from 'react-dom'
import type { BubbleLayout } from '../recorder/bubbleLayout'
import { CameraBubblePreview } from './CameraBubblePreview'

type CameraPlacementProps = {
	stream: MediaStream
	bubble: BubbleLayout
	onChange: (next: BubbleLayout) => void
	onConfirm: () => void
	onCancel: () => void
	labels: {
		heading: string
		canvas: string
		hint: string
		confirm: string
		cancel: string
	}
}

/**
 * Places the camera bubble against the frame that is about to be recorded. It appears once the
 * screen has been picked, so the aspect ratio is the real one, and the layout written here is read
 * by the compositor on its next frame. Rendered at the document root because the drawer is too
 * narrow for it.
 */
export const CameraPlacement = ({
	stream,
	bubble,
	onChange,
	onConfirm,
	onCancel,
	labels,
}: CameraPlacementProps) => {
	if (typeof document === 'undefined') return null

	return createPortal(
		<div className="fr-placement">
			<div className="fr-placement__panel">
				<h2 className="fr-placement__heading">{labels.heading}</h2>
				<CameraBubblePreview
					bubble={bubble}
					hint={labels.hint}
					label={labels.canvas}
					onChange={onChange}
					stream={stream}
				/>
				<div className="fr-placement__actions">
					<button className="fr-button" onClick={onCancel} type="button">
						{labels.cancel}
					</button>
					<button className="fr-button fr-button--primary" onClick={onConfirm} type="button">
						{labels.confirm}
					</button>
				</div>
			</div>
		</div>,
		document.body
	)
}
