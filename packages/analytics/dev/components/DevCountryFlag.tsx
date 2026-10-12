'use client'

import type { CountryFlagProps } from '@10x-media/analytics/client'

/** Regional indicator A, less the code of `A`: each letter of a country code maps onto one. */
const REGIONAL_OFFSET = 0x1f1e6 - 65

/**
 * `countryFlags.Component` as a host writes one: the country's flag as an emoji, drawn from the
 * code the plugin hands each row, in place of the plugin's own artwork.
 */
export function DevCountryFlag({ code }: CountryFlagProps) {
	const emoji = String.fromCodePoint(
		...[...code.toUpperCase()].map((letter) => REGIONAL_OFFSET + letter.charCodeAt(0))
	)
	return (
		<span aria-hidden="true" className="dev-country-flag">
			{emoji}
		</span>
	)
}
