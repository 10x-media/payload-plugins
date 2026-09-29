'use client'

import type { ChatSlotProps } from '@10x-media/conversations/client'

/**
 * `system.note`, a `layout: 'bare'` type: the component is the whole row, so
 * it draws its own one-line look and names the (system) author itself.
 */
export const SystemNote = ({ authors, message }: ChatSlotProps) => {
	const text = (message?.data as { text?: string } | undefined)?.text ?? ''
	const author = message ? authors?.[message.authorKey]?.name : undefined
	return (
		<div
			style={{
				alignItems: 'baseline',
				color: 'var(--theme-elevation-600)',
				display: 'flex',
				fontSize: '0.923rem',
				gap: '0.462rem',
			}}
		>
			<span aria-hidden="true">ⓘ</span>
			<span>
				{author ? <strong>{author}: </strong> : null}
				{text}
			</span>
		</div>
	)
}
