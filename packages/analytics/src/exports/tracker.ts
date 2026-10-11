/**
 * Browser tracker with zero runtime dependencies, for a plain HTML site's own bundle; Next apps use
 * the `/react` components instead.
 */
export type {
	AdminDigest,
	CaptureClientKind,
	CaptureSlot,
	CaptureSnippet,
	GoalMatch,
	ResolvedAutoCapture,
	ResolvedItemCapture,
	RevenueItem,
	SnippetScript,
	TrackerConfig,
	TrackerExclusion,
	TrackerGoal,
	TrackerSkip,
	TrackerSlotConfig,
} from '../tracker/config'
export { createTracker } from '../tracker/createTracker'
export { DEFAULT_EXCLUSION_PARAM, EXCLUSION_STORAGE_KEY } from '../tracker/exclusion'
export { DEFAULT_TRACKER_ENDPOINT, type InitTrackerArgs, initTracker } from '../tracker/initTracker'
export type {
	GateState,
	GateStatus,
	ItemOptions,
	LoadScript,
	PurchaseInput,
	RefundInput,
	Tracker,
	TrackerOptions,
	TrackerWindow,
	TrackGoalOptions,
} from '../tracker/types'
