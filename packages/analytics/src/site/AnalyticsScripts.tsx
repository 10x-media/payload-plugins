import type { ReactElement } from 'react'
import { TrackerBoot } from '../react/TrackerBoot'
import type { CaptureSnippet, TrackerConfig, TrackerSlotConfig } from '../tracker/config'
import { gateAnswer, openAtBoot, slotIsGated, slotMode } from '../tracker/gate'
import { skipsDraft } from '../tracker/skip'
import type { GateState, GateStatus } from '../tracker/types'

export interface AnalyticsScriptsProps {
	/** Resolved server-side, by `getTrackerConfig` or the tracker endpoint. */
	config: TrackerConfig
	/**
	 * The visitor's decision when the server knows it: opened slots render and boot open, closed ones
	 * render only when they count after a refusal. Omitted, every held slot boots pending.
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

const bootStatus = (slot: TrackerSlotConfig, gate: GateState | undefined): GateStatus => {
	if (openAtBoot(slot, gate)) {
		return 'open'
	}
	return gateAnswer(gate, slot.slot, slotIsGated(slot)) === false ? 'closed' : 'pending'
}

/**
 * The snippet a slot renders with the page, so its first pageview is counted with it: the full
 * variant when open, the slot's own while it counts without consent, none while it sends nothing.
 */
const bootSnippet = (
	slot: TrackerSlotConfig,
	gate: GateState | undefined
): CaptureSnippet | undefined => {
	const status = bootStatus(slot, gate)
	if (slotMode(slot, status) === 'off') {
		return undefined
	}
	return status === 'open' ? (slot.fullSnippet ?? slot.snippet) : slot.snippet
}

/**
 * Renders the snippet of each slot capturing at boot, then boots the tracker; a slot sending
 * nothing yet gets its snippet once `setGate` opens it. A draft page renders none while
 * `capture.skip.previews` is on.
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
				rendersSnippets
					? (bootSnippet(slot, gate)?.scripts ?? []).map((script, index) => (
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
