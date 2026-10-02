export type { MatchSignal, SignalKind } from '../match/score'
export type { ApplyMergeResult } from '../merge/apply'
export type { DecisionView, DocRef, PlanResponse } from '../merge/planResponse'
export type { RepointDocRef, Repointed, RepointPreview } from '../merge/repoint'
export type { UniqueRelease } from '../merge/unique'
export type {
	CollectionDedupeOptions,
	CollectionOverride,
	CompareFn,
	ComparePreset,
	DedupeAccess,
	DedupePluginOptions,
	MatchConfig,
	MatchFieldConfig,
	MultiTenancyOptions,
} from '../options'
export type { DedupeEvent, DedupeEventSink } from '../plugin/events'
export type { CheckResponse } from '../plugin/registerEndpoints'
export type { Duplicate } from '../queue/live'
export type { ScanSummary } from '../queue/scan'
export type { DedupeFieldConfig } from '../schema/fieldConfig'
export type {
	DecisionSource,
	DocValue,
	MergeChoice,
	MergeDecision,
	MergeFieldSpec,
	MergePolicy,
	ReferenceSpec,
} from '../schema/types'
export type {
	AdapterDoc,
	CandidateHit,
	DedupeAdapter,
	DedupeAdapterFactory,
	FindCandidatesArgs,
	IndexArgs,
	KeyBucket,
	RemoveArgs,
	ScanArgs,
	ScanPage,
} from '../search/contract'
