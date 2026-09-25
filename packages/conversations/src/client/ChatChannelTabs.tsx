'use client'

import { Button } from '@payloadcms/ui'

import { GlobeIcon, LockIcon } from '../composer/icons'
import { type ChannelView, resolveLabel } from '../react/hooks'
import { useTranslation } from '../translations/useTranslation'

export type ChatChannelTabsProps = {
	active: string
	channels: ChannelView[]
	onChange: (channel: string) => void
	/** False with `reads: false`: no counts. */
	reads?: boolean
}

/** One tab per readable channel, with its unread count. Renders nothing for a single channel. */
export const ChatChannelTabs = ({
	active,
	channels,
	onChange,
	reads = true,
}: ChatChannelTabsProps) => {
	const { i18n } = useTranslation()
	if (channels.length < 2) return null
	return (
		<div className="conversations-tabs" role="tablist">
			{channels.map((channel) => (
				// Payload's own tab button, as its list view tabs: the active one is disabled.
				<Button
					buttonStyle="tab"
					className={`conversations-tabs__tab${channel.slug === active ? ' conversations-tabs__tab--active' : ''}`}
					disabled={channel.slug === active}
					// Who reads it, from the channel's cue: a lock inside, a globe for outside.
					icon={
						channel.cue ? channel.cue.tone === 'warning' ? <GlobeIcon /> : <LockIcon /> : undefined
					}
					iconPosition="left"
					extraButtonProps={{ 'aria-selected': channel.slug === active, role: 'tab' }}
					key={channel.slug}
					margin={false}
					onClick={() => onChange(channel.slug)}
					size="medium"
				>
					{resolveLabel(channel.label, i18n.language)}
					{reads && channel.unread > 0 ? (
						<span className="conversations-tabs__count">
							{channel.unread > 99 ? '99+' : channel.unread}
						</span>
					) : null}
				</Button>
			))}
		</div>
	)
}
