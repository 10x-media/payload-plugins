import type { ReactElement } from 'react'
import { TrackerBoot } from '../react/TrackerBoot'
import type { TrackerConfig } from '../tracker/config'
import { openAtBoot } from '../tracker/gate'
import { skipsDraft } from '../tracker/skip'
import type { GateState } from '../tracker/types'

export interface AnalyticsScriptsProps {
	/** Resolved server-side, by `getTrackerConfig` or the tracker endpoint. */
	config: TrackerConfig
	/**
	 * The visitor's decision when the server knows it: opened slots render and boot open, closed ones
	 * render nothing. Omitted, every held slot waits for `setGate` in the browser.
	 */
	gate?: GateState
	/**
	 * `false` renders no vendor snippet and has the tracker inject none either, for a consent
	 * manager that loads the vendor SDKs itself. Default true.
	 */
	snippets?: boolean
	/** CSP nonce, applied to every script this renders and the tracker injects. */
	nonce?: string
}

/**
 * Renders each boot-open slot's snippet, then boots the tracker; a held slot's snippet is injected
 * once `setGate` opens it. A draft page renders none while `capture.skip.previews` is on.
 */
export const AnalyticsScripts = ({
	config,
	gate,
	snippets = true,
	nonce,
}: AnalyticsScriptsProps): ReactElement => {
	const rendersSnippets = snippets && !skipsDraft(config)
	return (
		<>
			{config.slots.flatMap((slot) =>
				rendersSnippets && openAtBoot(slot, gate)
					? slot.snippet.scripts.map((script, index) => (
							<script
								// biome-ignore lint/suspicious/noArrayIndexKey: a snippet's scripts are a fixed list, never reordered
								key={`${slot.slot}-${index}`}
								{...script.attrs}
								async={script.async}
								defer={script.defer}
								// biome-ignore lint/security/noDangerouslySetInnerHtml: adapter-authored vendor init
								dangerouslySetInnerHTML={script.inline ? { __html: script.inline } : undefined}
								nonce={nonce}
								src={script.inline ? undefined : script.src}
								type={script.type}
							/>
						))
					: []
			)}
			<TrackerBoot config={config} gate={gate} nonce={nonce} snippets={snippets} />
		</>
	)
}
