type Channel = { id: string; name: string }

/**
 * Resolves the initially selected channel ID for the click-to-dial picker.
 * Prefers the user-configured `defaultChannelId` when it appears in the channel list,
 * falls back to the first channel, then to `defaultChannelId` itself (e.g. when the
 * channel list is still loading).
 */
export function resolveInitialChannel(
	channels: Channel[] | undefined,
	defaultChannelId: string | undefined
): string | undefined {
	if (!channels || channels.length === 0) return defaultChannelId
	const explicit = channels.find((c) => c.id === defaultChannelId)
	if (explicit) return explicit.id
	return channels[0]?.id ?? defaultChannelId
}
