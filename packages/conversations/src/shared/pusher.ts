/**
 * Pusher channel names for conversations, shared by the server (which
 * triggers and authorizes) and the browser (which subscribes). One private
 * channel per instance, key and conversation channel, so a signal only
 * reaches people who can read that channel.
 */

const toBase64Url = (value: string): string => {
	const bytes = new TextEncoder().encode(value)
	let binary = ''
	for (const byte of bytes) binary += String.fromCharCode(byte)
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Pusher's own limit on a channel name. */
export const PUSHER_CHANNEL_MAX = 164

/**
 * `private-cv-<instance>-<key>.<channel>`, key and channel base64url-encoded
 * (Pusher allows only `A-Za-z0-9_-=@,.;` in names). Keys longer than about
 * 100 characters exceed Pusher's 164-character limit.
 */
export const pusherChannelName = (instance: string, key: string, channel: string): string =>
	`private-cv-${instance}-${toBase64Url(key)}.${toBase64Url(channel)}`

/** The event every conversations channel carries: `{ keys: string[] }`. */
export const PUSHER_EVENT = 'changed'
