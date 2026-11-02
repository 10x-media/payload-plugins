'use client'

import { useEffect, useRef, useState } from 'react'
import { meterWidth, rmsLevel } from '../recorder/micLevel'

type MicLevelMeterProps = {
	stream: MediaStream
	label: string
	/** Shown when the meter has seen nothing but silence for a while. */
	silentHint: string
}

const SILENCE_MS = 4000
/** A quiet room still reports a trickle of noise; anything under this counts as silence. */
const SOUND_THRESHOLD = 0.02

/**
 * Whether anybody can hear you. A muted microphone or the wrong input produces a recording that is
 * fine in every respect except the one that mattered, so the meter shows it while there is still
 * time to fix it. The `AudioContext` is closed on every exit path.
 */
export const MicLevelMeter = ({ stream, label, silentHint }: MicLevelMeterProps) => {
	const [width, setWidth] = useState(0)
	const [silent, setSilent] = useState(false)
	const lastSoundRef = useRef(Date.now())

	useEffect(() => {
		const context = new AudioContext()
		const analyser = context.createAnalyser()
		analyser.fftSize = 512
		context.createMediaStreamSource(stream).connect(analyser)

		const samples = new Uint8Array(analyser.fftSize)
		let frame = 0

		const tick = () => {
			analyser.getByteTimeDomainData(samples)
			const level = rmsLevel(samples)
			setWidth(meterWidth(level))
			if (level > SOUND_THRESHOLD) lastSoundRef.current = Date.now()
			setSilent(Date.now() - lastSoundRef.current > SILENCE_MS)
			frame = requestAnimationFrame(tick)
		}
		frame = requestAnimationFrame(tick)

		return () => {
			cancelAnimationFrame(frame)
			void context.close()
		}
	}, [stream])

	return (
		<div className="fr-meter">
			<meter aria-label={label} className="fr-meter__bar" max={100} min={0} value={width}>
				{width}%
			</meter>
			{silent && <p className="fr-meter__hint">{silentHint}</p>}
		</div>
	)
}
