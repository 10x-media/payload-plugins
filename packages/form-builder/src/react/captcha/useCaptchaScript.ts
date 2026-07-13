'use client'

import { useEffect, useState } from 'react'

const pending = new Map<string, Promise<void>>()

const loadScript = (src: string): Promise<void> => {
	const cached = pending.get(src)
	if (cached) {
		return cached
	}
	const promise = new Promise<void>((resolve, reject) => {
		const script = document.createElement('script')
		script.src = src
		script.async = true
		script.addEventListener('load', () => resolve())
		script.addEventListener('error', () => {
			pending.delete(src)
			script.remove()
			reject(new Error(`Failed to load ${src}`))
		})
		document.head.appendChild(script)
	})
	pending.set(src, promise)
	return promise
}

/**
 * Load a vendor captcha script once per src, shared across all widget instances. SSR-safe (the
 * DOM is only touched inside the effect). A failed load evicts the cache entry so a later mount
 * can retry; consumers just see `ready` stay false.
 */
export const useCaptchaScript = (src: string): boolean => {
	const [ready, setReady] = useState(false)
	useEffect(() => {
		let active = true
		setReady(false)
		loadScript(src).then(
			() => {
				if (active) {
					setReady(true)
				}
			},
			() => {}
		)
		return () => {
			active = false
		}
	}, [src])
	return ready
}
