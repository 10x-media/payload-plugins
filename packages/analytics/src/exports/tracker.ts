/**
 * The browser tracker. Zero runtime dependencies (no React, no Payload, no Node built-ins)
 * so a plain HTML site can import it from its own bundle; Next apps get it through the
 * `/react` components instead.
 */
export type { TrackerConfig, TrackerSlotConfig } from '../capture/trackerConfig'
export type { CaptureSnippet, SnippetScript } from '../core/capture'
export type { ResolvedAutoCapture } from '../core/options'
export type { TrackerGoal } from '../goals/types'
export {
	type AutoCapture,
	type AutoCaptureHandlers,
	createAutoCapture,
	DOWNLOAD_EVENT,
	GOAL_ATTRIBUTE,
	OUTBOUND_EVENT,
	SCROLL_EVENT,
} from '../tracker/autoCapture'
export {
	CONSENT_QUEUE_LIMIT,
	CONSENT_STORAGE_KEY,
	createConsentQueue,
	readConsent,
	writeConsent,
} from '../tracker/consent'
export { createNoopTracker, createTracker } from '../tracker/createTracker'
export { DEFAULT_TRACKER_ENDPOINT, type InitTrackerArgs, initTracker } from '../tracker/initTracker'
export { createScriptLoader } from '../tracker/loadScript'
export { createPageTracking, type PageTracking } from '../tracker/pageTracking'
export { createNativeSink, PAGEVIEW_BUFFER_MS } from '../tracker/sinks/native'
export { createPlausibleSink } from '../tracker/sinks/plausible'
export { createPosthogSink } from '../tracker/sinks/posthog'
export { createUmamiSink } from '../tracker/sinks/umami'
export type { VendorSinkArgs } from '../tracker/sinks/vendor'
export type {
	ConsentState,
	LoadScript,
	Sink,
	Tracker,
	TrackerEvent,
	TrackerOptions,
	TrackerWindow,
} from '../tracker/types'
