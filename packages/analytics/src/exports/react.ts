'use client'

export {
	type AnalyticsApi,
	type AnalyticsCommands,
	AnalyticsProvider,
	type AnalyticsProviderProps,
} from '../react/AnalyticsProvider'
export { useAnalytics } from '../react/useAnalytics'
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
export type {
	GateState,
	GateStatus,
	ItemOptions,
	LoadScript,
	PurchaseInput,
	RefundInput,
	Tracker,
	TrackGoalOptions,
} from '../tracker/types'
