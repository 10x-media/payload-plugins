'use client'

import { useConfig } from '@payloadcms/ui'
import { type ComponentType, useState } from 'react'
import { countryFlagSrc, countryFlagsMount } from './flagSrc'
import '../ui/analytics.css'

export interface CountryFlagImgProps {
	/** A fully formed flag-route URL; server surfaces build their own from `req`. */
	src: string
}

/**
 * Flag image, decoration only: hidden from assistive tech, the country's name beside it. A failed
 * load hides rather than removes it, so its box stays and rows do not reflow.
 */
export function CountryFlagImg({ src }: CountryFlagImgProps) {
	// Keyed by src rather than a bare boolean: a re-ranked list reuses this element for
	// another country, which deserves its own attempt rather than the last one's failure.
	const [failedSrc, setFailedSrc] = useState<string | null>(null)
	return (
		// biome-ignore lint/performance/noImgElement: a Payload plugin cannot reach the host's next/image loader, and these are 20x15 SVGs on an admin screen
		<img
			alt=""
			aria-hidden="true"
			className={failedSrc === src ? 'analytics-flag analytics-flag--failed' : 'analytics-flag'}
			decoding="async"
			height={15}
			loading="lazy"
			onError={() => setFailedSrc(src)}
			src={src}
			width={20}
		/>
	)
}

/** @beta */
export interface CountryFlagProps {
	/** ISO 3166-1 alpha-2 code, upper or lower case. */
	code: string
}

/** {@link CountryFlagImg} pointed at this install's own flag route. */
export function CountryFlag({ code }: CountryFlagProps) {
	const { config } = useConfig()
	return <CountryFlagImg src={countryFlagSrc(countryFlagsMount(config), code)} />
}

/**
 * The host's `countryFlags.Component` as a server surface hands it to a client one.
 *
 * @beta
 */
export interface HostCountryFlag {
	Component: ComponentType<CountryFlagProps>
	/** The `clientProps` its config gave it, which every row's flag receives. */
	props?: object
}

/**
 * What a client surface draws beside a country's name: nothing, the plugin's own flag, or the
 * host's component, looked up once by the server surface and handed down.
 *
 * @beta
 */
export type CountryFlags = boolean | HostCountryFlag

/** One row's flag: the host's component given the row's `code`, else the plugin's own. */
export function RowFlag({ flags, code }: { flags: CountryFlags; code: string }) {
	if (flags === false) {
		return null
	}
	if (flags === true) {
		return <CountryFlag code={code} />
	}
	const { Component, props } = flags
	return <Component {...props} code={code} />
}
