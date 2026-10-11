'use client'

import type { AuthorProjection } from '../types'

const initials = (name: string) =>
	name
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase() ?? '')
		.join('') || '?'

/** A stable hue per user, so one person keeps one colour across the admin. */
const hue = (value: string) => {
	// FNV-1a, so keys that differ only in their last character still land far apart.
	let hash = 0x811c9dc5
	for (const char of value) {
		hash ^= char.charCodeAt(0)
		hash = Math.imul(hash, 0x01000193)
	}
	return (hash >>> 0) % 360
}

export type AvatarProps = {
	author?: Pick<AuthorProjection, 'avatar' | 'deleted' | 'name'>
	/** Replaces the default class; `--conversations-avatar-hue` stays set for colouring. */
	className?: string
	size?: number
	userKey: string
}

/** The author's picture, or their initials on a colour derived from their key. */
export const Avatar = ({
	author,
	className = 'conversations-avatar',
	size = 28,
	userKey,
}: AvatarProps) => {
	const name = author?.name ?? ''
	if (author?.avatar) {
		return (
			<img
				alt=""
				className={className}
				height={size}
				src={author.avatar}
				style={{ height: size, width: size }}
				width={size}
			/>
		)
	}
	return (
		<span
			aria-hidden="true"
			className={className}
			style={
				{
					'--conversations-avatar-hue': author?.deleted ? undefined : hue(userKey),
					fontSize: Math.round(size * 0.38),
					height: size,
					width: size,
				} as React.CSSProperties
			}
		>
			{author?.deleted ? '' : initials(name)}
		</span>
	)
}
