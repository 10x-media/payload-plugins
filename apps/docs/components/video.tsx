'use client'

import { useEffect, useRef } from 'react'

export type VideoProps = {
	/**
	 * What the clip shows, for anyone who cannot watch it. These are showcases of
	 * something the surrounding prose already explains, so this is a label rather
	 * than a transcript.
	 */
	alt: string
	/** Path under `public/`, e.g. `/videos/admin-wiki/field-help.mp4`. */
	src: string
}

/**
 * A showcase clip: silent, looping, no controls.
 *
 * Playback is tied to visibility rather than to `autoplay`. A page carrying four
 * of these would otherwise fetch and decode all four at once, three of them
 * below the fold, and the poster frame is enough until one is actually on
 * screen.
 */
export const Video = ({ alt, src }: VideoProps) => {
	const ref = useRef<HTMLVideoElement>(null)

	useEffect(() => {
		const element = ref.current
		if (!element) {
			return
		}
		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry?.isIntersecting) {
					// Rejected when the browser declines to autoplay, which is not a
					// failure worth reporting: the poster stays up and nothing breaks.
					void element.play().catch(() => undefined)
				} else {
					element.pause()
				}
			},
			{ threshold: 0.35 }
		)
		observer.observe(element)
		return () => observer.disconnect()
	}, [])

	return (
		<video
			aria-label={alt}
			className="my-6 w-full rounded-lg border border-fd-border"
			loop
			muted
			playsInline
			poster={src.replace(/\.mp4$/, '.png')}
			preload="metadata"
			ref={ref}
		>
			<source src={src} type="video/mp4" />
		</video>
	)
}
