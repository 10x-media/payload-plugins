'use client'

import { ChatProvider, pollingTransport } from '@10x-media/conversations/react'
import { useTheme } from '@payloadcms/ui'
import { type ReactNode, useEffect, useMemo, useState } from 'react'

import { mockServer } from './mockServer'
import { type LiveTarget, stories } from './stories'
import './playground.css'

const WIDTHS = [
	{ label: '400', value: '400px' },
	{ label: '560', value: '560px' },
	{ label: 'Drawer 640', value: '49.231rem' },
	{ label: 'Full', value: '100%' },
]

const LATENCIES = [0, 250, 1500]

/** Short intervals, so a mock "Anna posts" shows up within seconds. */
const mockTransport = pollingTransport({ intervals: { active: 2_000, idle: 4_000 } })

/**
 * The same `ChatProvider` the admin uses, for the same instance slug, with
 * its `fetch` pointed at the in-memory mock. Nested inside the admin's own
 * provider it wins for everything below it, while the composer still gets
 * its form state from the real `comments-messages` collection.
 */
const MockProvider = ({ children }: { children: ReactNode }) => (
	<ChatProvider fetch={mockServer.fetch} instance="comments" transport={mockTransport}>
		{children}
	</ChatProvider>
)

const readStory = () => {
	if (typeof window === 'undefined') return stories[0]?.id ?? ''
	const id = window.location.hash.slice(1)
	return stories.some((story) => story.id === id) ? id : (stories[0]?.id ?? '')
}

/** A small storybook for the plugin's UI, registered as `/admin/playground` in the dev app. */
export const Playground = ({ live }: { live: LiveTarget[] }) => {
	const [storyId, setStoryId] = useState(stories[0]?.id ?? '')
	const [width, setWidth] = useState(WIDTHS[2]?.value ?? '100%')
	const { setTheme, theme } = useTheme()
	const [knobs, setKnobs] = useState(mockServer.knobs)
	const [generation, setGeneration] = useState(0)

	useEffect(() => {
		setStoryId(readStory())
		const onHash = () => setStoryId(readStory())
		window.addEventListener('hashchange', onHash)
		return () => window.removeEventListener('hashchange', onHash)
	}, [])

	const setKnob = <K extends keyof typeof knobs>(name: K, value: (typeof knobs)[K]) => {
		mockServer.knobs = { ...mockServer.knobs, [name]: value }
		setKnobs(mockServer.knobs)
	}

	const story = stories.find((item) => item.id === storyId) ?? stories[0]
	const groups = useMemo(() => [...new Set(stories.map((item) => item.group))], [])

	return (
		<div className="pg">
			<nav className="pg-nav">
				{groups.map((group) => (
					<div className="pg-nav__group" key={group}>
						<div className="pg-nav__heading">{group}</div>
						{stories
							.filter((item) => item.group === group)
							.map((item) => (
								<a
									className={`pg-nav__link${item.id === story?.id ? ' pg-nav__link--active' : ''}`}
									href={`#${item.id}`}
									key={item.id}
								>
									{item.title}
								</a>
							))}
					</div>
				))}
			</nav>
			<div className="pg-main">
				<div className="pg-toolbar">
					<div className="pg-toolbar__group">
						<span className="pg-toolbar__label">Width</span>
						{WIDTHS.map((option) => (
							<button
								className={`pg-chip${width === option.value ? ' pg-chip--active' : ''}`}
								key={option.value}
								onClick={() => setWidth(option.value)}
								type="button"
							>
								{option.label}
							</button>
						))}
					</div>
					<div className="pg-toolbar__group">
						<span className="pg-toolbar__label">Theme</span>
						{(['light', 'dark'] as const).map((value) => (
							<button
								className={`pg-chip${theme === value ? ' pg-chip--active' : ''}`}
								key={value}
								onClick={() => setTheme(value)}
								type="button"
							>
								{value}
							</button>
						))}
					</div>
					{story?.backend === 'mock' ? (
						<div className="pg-toolbar__group">
							<span className="pg-toolbar__label">Mock latency</span>
							{LATENCIES.map((value) => (
								<button
									className={`pg-chip${knobs.latency === value ? ' pg-chip--active' : ''}`}
									key={value}
									onClick={() => setKnob('latency', value)}
									type="button"
								>
									{value} ms
								</button>
							))}
							<label className="pg-check">
								<input
									checked={knobs.failSends}
									onChange={(event) => setKnob('failSends', event.target.checked)}
									type="checkbox"
								/>
								Fail sends
							</label>
							<label className="pg-check">
								<input
									checked={knobs.failLoads}
									onChange={(event) => setKnob('failLoads', event.target.checked)}
									type="checkbox"
								/>
								Fail loads
							</label>
							<button
								className="pg-chip"
								onClick={() => {
									mockServer.reset()
									setGeneration((value) => value + 1)
								}}
								type="button"
							>
								Reset data
							</button>
						</div>
					) : null}
				</div>
				{story ? (
					<div className="pg-canvas" style={{ '--pg-width': width } as React.CSSProperties}>
						<header className="pg-canvas__header">
							<h2 className="pg-canvas__title">{story.title}</h2>
							<p className="pg-canvas__description">{story.description}</p>
						</header>
						{story.backend === 'mock' ? (
							<MockProvider key={`${story.id}:${generation}`}>
								{story.render({ live })}
							</MockProvider>
						) : (
							<div key={story.id}>{story.render({ live })}</div>
						)}
					</div>
				) : null}
			</div>
		</div>
	)
}
