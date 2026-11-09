'use client'

import { TabButton, TabsList } from '@payloadcms/ui'

import { GlobeIcon, LockIcon } from '../composer/icons'
import { type ChannelView, resolveLabel } from '../react/hooks'
import { useTranslation } from '../translations/useTranslation'
import { replaceable } from './components'

export type ChatChannelTabsProps = {
	active: string
	channels: ChannelView[]
	onChange: (channel: string) => void
	/** False with `reads: false`: no counts. */
	reads?: boolean
}

/** One tab per readable channel, with its unread count. Renders nothing for a single channel. */
const DefaultChannelTabs = ({ active, channels, onChange, reads = true }: ChatChannelTabsProps) => {
	const { i18n } = useTranslation()
	if (channels.length < 2) return null
	return (
		<TabsList className="conversations-tabs">
			{channels.map((channel) => (
				<TabButton
					className="conversations-tabs__tab"
					isActive={channel.slug === active}
					key={channel.slug}
					modifierClassName="conversations-tabs__tab"
					onClick={() => onChange(channel.slug)}
				>
					{/* Who reads it, from the channel's cue: a lock inside, a globe for outside. */}
					{channel.cue ? channel.cue.tone === 'warning' ? <GlobeIcon /> : <LockIcon /> : null}
					{resolveLabel(channel.label, i18n.language)}
					{reads && channel.unread > 0 ? (
						<span className="conversations-tabs__count">
							{channel.unread > 99 ? '99+' : channel.unread}
						</span>
					) : null}
				</TabButton>
			))}
		</TabsList>
	)
}

/** The channel tabs. Replaceable through `components.ChannelTabs`. */
export const ChatChannelTabs = replaceable('ChannelTabs', DefaultChannelTabs)
