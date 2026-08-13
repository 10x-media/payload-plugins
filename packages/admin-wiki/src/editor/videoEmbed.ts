/**
 * YouTube / Vimeo URL parsing for the video embed block. Client-safe and free
 * of Payload imports; the block validate function and the read renderer both
 * use it. Ported from paddle-worldwide's videoEmbed prior art.
 */

export type VideoEmbedSource = {
	embedUrl: string
	provider: 'vimeo' | 'youtube'
}

const YOUTUBE_HOSTS = new Set([
	'm.youtube.com',
	'www.youtube-nocookie.com',
	'www.youtube.com',
	'youtube-nocookie.com',
	'youtube.com',
])

const YOUTUBE_ID = /^[\w-]{5,20}$/
const VIMEO_ID = /^\d{4,15}$/
const VIMEO_HASH = /^[\da-f]{6,16}$/

const youtubeEmbed = (id: string): null | VideoEmbedSource =>
	YOUTUBE_ID.test(id)
		? { embedUrl: `https://www.youtube-nocookie.com/embed/${id}`, provider: 'youtube' }
		: null

const vimeoEmbed = (id: string, hash?: string): null | VideoEmbedSource => {
	if (!VIMEO_ID.test(id)) {
		return null
	}
	const suffix = hash && VIMEO_HASH.test(hash) ? `&h=${hash}` : ''
	return { embedUrl: `https://player.vimeo.com/video/${id}?dnt=1${suffix}`, provider: 'vimeo' }
}

/** Parse a watch-page or share URL into a privacy-friendly embed source. */
export const parseVideoEmbedUrl = (raw: string): null | VideoEmbedSource => {
	let url: URL
	try {
		url = new URL(raw.trim())
	} catch {
		return null
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		return null
	}
	const host = url.hostname.toLowerCase()
	const segments = url.pathname.split('/').filter(Boolean)

	if (host === 'youtu.be') {
		return segments[0] ? youtubeEmbed(segments[0]) : null
	}
	if (YOUTUBE_HOSTS.has(host)) {
		if (segments[0] === 'watch') {
			const id = url.searchParams.get('v')
			return id ? youtubeEmbed(id) : null
		}
		if (
			(segments[0] === 'shorts' || segments[0] === 'embed' || segments[0] === 'live') &&
			segments[1]
		) {
			return youtubeEmbed(segments[1])
		}
		return null
	}

	if (host === 'vimeo.com' || host === 'www.vimeo.com') {
		return segments[0] ? vimeoEmbed(segments[0], segments[1]) : null
	}
	if (host === 'player.vimeo.com') {
		return segments[0] === 'video' && segments[1] ? vimeoEmbed(segments[1], segments[2]) : null
	}

	return null
}
