import type { ReactElement } from 'react'
import type { TrackerConfig } from '../capture/trackerConfig'
import { TrackerBoot } from '../react/TrackerBoot'

export interface AnalyticsScriptsProps {
	/** Resolved server-side, by `getTrackerConfig` or the tracker endpoint. */
	config: TrackerConfig
	/** CSP nonce, applied to every script this renders. */
	nonce?: string
}

/**
 * Renders each capture slot's vendor snippet, then boots the tracker over them. Snippet
 * scripts come from the slot adapter's own `capture.snippet`, so they are plugin-authored
 * strings rather than anything a request supplied; the inline ones are injected verbatim
 * because a vendor init call has to parse as script, not as text.
 *
 * A slot that waits for consent renders nothing: shipping its script in the HTML would run
 * the vendor's tracker before the visitor answered, which is the whole point of the gate.
 * Its sink injects the same snippet once consent is granted (or immediately, when a granted
 * decision was already persisted), and the loader skips scripts the page already carries.
 *
 * A native-only install renders no snippet at all: the tracker is the client.
 */
export const AnalyticsScripts = ({ config, nonce }: AnalyticsScriptsProps): ReactElement => (
	<>
		{config.slots.flatMap((slot) =>
			slot.requiresConsent
				? []
				: slot.snippet.scripts.map((script, index) => {
						const key = `${slot.slot}-${index}`
						return script.inline ? (
							<script
								key={key}
								{...script.attrs}
								async={script.async}
								defer={script.defer}
								// biome-ignore lint/security/noDangerouslySetInnerHtml: adapter-authored vendor init
								dangerouslySetInnerHTML={{ __html: script.inline }}
								nonce={nonce}
								type={script.type}
							/>
						) : (
							<script
								key={key}
								{...script.attrs}
								async={script.async}
								defer={script.defer}
								nonce={nonce}
								src={script.src}
								type={script.type}
							/>
						)
					})
		)}
		<TrackerBoot config={config} nonce={nonce} />
	</>
)
