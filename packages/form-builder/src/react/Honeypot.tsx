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
 * A visually hidden honeypot decoy. Real users never see or tab to it; bots that fill every input trip it,
 * and the server rejects the submission. Off-screen + aria-hidden + tabIndex -1 + autoComplete off.
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
				autoComplete="off"
				defaultValue=""
			/>
		</label>
	</div>
)
