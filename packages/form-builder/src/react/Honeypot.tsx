'use client'

import type { CSSProperties, Ref } from 'react'

const HIDDEN: CSSProperties = {
	position: 'absolute',
	width: 1,
	height: 1,
	padding: 0,
	margin: -1,
	overflow: 'hidden',
	clip: 'rect(0, 0, 0, 0)',
	whiteSpace: 'nowrap',
	border: 0,
}

export type HoneypotProps = {
	name: string
	inputRef?: Ref<HTMLInputElement>
}

/**
 * A visually hidden honeypot decoy. Real users never see or tab to it; bots that fill every input
 * trip it, and the server rejects the submission.
 *
 * `autoComplete="new-password"` is used instead of `"off"` because Chrome frequently ignores `"off"`
 * but reliably respects `"new-password"` to prevent autofill. The field name is intentionally generic
 * (no "email" token) to avoid Chrome's email-address heuristic.
 */
export const Honeypot = ({ name, inputRef }: HoneypotProps) => (
	<div aria-hidden="true" style={HIDDEN}>
		<label>
			Leave this field empty
			<input
				ref={inputRef}
				type="text"
				name={name}
				tabIndex={-1}
				autoComplete="new-password"
				defaultValue=""
			/>
		</label>
	</div>
)
