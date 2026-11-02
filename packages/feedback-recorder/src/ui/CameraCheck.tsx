'use client'

import { useEffect, useRef } from 'react'

type CameraCheckProps = {
	stream: MediaStream
	label: string
	hint: string
}

/**
 * The camera on its own, mirrored like every camera preview, so a person can check framing and
 * light before recording. Where the bubble sits is decided later against the real shared screen.
 */
export const CameraCheck = ({ stream, label, hint }: CameraCheckProps) => {
	const videoRef = useRef<HTMLVideoElement | null>(null)

	useEffect(() => {
		const video = videoRef.current
		if (!video) return
		video.srcObject = stream
		void video.play().catch(() => undefined)
		return () => {
			video.srcObject = null
		}
	}, [stream])

	return (
		<div className="fr-camera-check">
			<video
				aria-label={label}
				className="fr-camera-check__video"
				muted
				playsInline
				ref={videoRef}
			/>
			<p className="fr-hint">{hint}</p>
		</div>
	)
}
