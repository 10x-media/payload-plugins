'use client'

import { useEffect, useState } from 'react'
import type { LoadScript } from '../adapters'

const pending = new Map<string, Promise<void>>()

const injectScript = (src: string): Promise<void> => {
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

// A custom loader gets the same per-src cache and evict-on-failure retry, keyed per loader so two
// adapters (or the default injector) never share entries.
const customCaches = new WeakMap<LoadScript, Map<string, Promise<void>>>()

const loadThrough = (loader: LoadScript, src: string): Promise<void> => {
	let cache = customCaches.get(loader)
	if (!cache) {
		cache = new Map()
		customCaches.set(loader, cache)
	}
	const cached = cache.get(src)
	if (cached) {
		return cached
	}
	const promise = loader(src).catch((error) => {
		cache.delete(src)
		throw error
	})
	cache.set(src, promise)
	return promise
}

/**
 * Load a vendor captcha script once per src, shared across all widget instances. SSR-safe (the
 * DOM is only touched inside the effect). A failed load evicts the cache entry so a later mount
 * can retry; consumers just see `ready` stay false. A host `loadScript` (e.g. a consent-gated
 * loader) replaces the `document.head` injection; pass a stable reference, since a new function
 * identity re-runs the load with a fresh cache.
 */
export const useCaptchaScript = (src: string, loadScript?: LoadScript): boolean => {
	const [ready, setReady] = useState(false)
	useEffect(() => {
		let active = true
		setReady(false)
		const load = loadScript ? loadThrough(loadScript, src) : injectScript(src)
		load.then(
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
	}, [src, loadScript])
	return ready
}
