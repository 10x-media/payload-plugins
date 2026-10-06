'use client'

import { useConfig } from '@payloadcms/ui'
import type React from 'react'
import { useState } from 'react'
import { emojiFlag } from '../engine/countries'
import type { CountryCode } from '../engine/phone'
import { countryFlagSrc, type PhoneFlagMode } from '../options'
import './phoneNumberField.css'

const baseClass = 'fields-phone'

export type CountryFlagProps = {
	code: CountryCode
	mode: PhoneFlagMode
}

/**
 * Decorative in every mode: each trigger and row that carries a flag also carries the
 * country's name, so the artwork stays out of the accessibility tree.
 */
export const CountryFlag: React.FC<CountryFlagProps> = ({ code, mode }) => {
	const { config } = useConfig()
	const [failedSrc, setFailedSrc] = useState<null | string>(null)

	if (mode === 'none') return null

	if (mode === 'emoji') {
		return (
			<span aria-hidden="true" className={`${baseClass}__flag ${baseClass}__flag--emoji`}>
				{emojiFlag(code)}
			</span>
		)
	}

	const src = countryFlagSrc(config.serverURL, config.routes.api, code)
	// A flag that fails keeps its box rather than unmounting, so the row beside it never
	// reflows; keying the failure by src lets a row reused for another country try again.
	const failed = failedSrc === src

	return (
		<img
			alt=""
			aria-hidden="true"
			className={`${baseClass}__flag`}
			decoding="async"
			height={15}
			loading="lazy"
			onError={() => setFailedSrc(src)}
			src={src}
			style={failed ? { visibility: 'hidden' } : undefined}
			width={20}
		/>
	)
}
