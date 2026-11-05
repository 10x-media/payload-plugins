/** What a site's own server components render the tracker with. No admin UI loads from here. */

export { AnalyticsScripts, type AnalyticsScriptsProps } from '../site/AnalyticsScripts'
export { getTrackerConfig } from '../site/getTrackerConfig'
export type {
	AdminDigest,
	CaptureClientKind,
	CaptureSlot,
	CaptureSnippet,
	ConsentPhase,
	GoalMatch,
	HeldSlotMode,
	ResolvedAutoCapture,
	ResolvedItemCapture,
	SlotMode,
	SlotWithoutConsent,
	SnippetScript,
	TrackerConfig,
	TrackerExclusion,
	TrackerGoal,
	TrackerSkip,
	TrackerSlotConfig,
} from '../tracker/config'
export type { GateState, GateStatus } from '../tracker/types'
