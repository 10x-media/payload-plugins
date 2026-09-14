import type { PayloadRequest } from 'payload'
import type { MetricKey } from '../core/contract'
import { DEFAULT_VIEW, type ResolvedOptions } from '../core/options'
import type { SourcesResponse } from '../fields/config/fetchSources'
import { resolveSourcesForRequest } from '../plugin/readContextForRequest'
import {
	type AnalyticsRuntime,
	getRuntime,
	type PlatformReadGate,
	platformReadGate,
	resolveGoalsDetailedFor,
	resolveScopeFor,
	resolveTimezoneFor,
} from '../plugin/runtime'
import type { TimeframePreset } from '../timeframe/presets'
import { DEFAULT_TIMEZONE } from '../timeframe/tz'

/** A goal as the view lists it: the picker needs no match or value details. */
export interface ViewGoal {
	slug: string
	name: string
}

/**
 * Everything the client shell needs to render without a second round trip. Serializable
 * by construction: the RSC boundary drops functions, so only wire shapes appear here.
 */
export interface AnalyticsViewClientProps {
	/** Same payload the sources endpoint answers, resolved for this request's scope. */
	sources: SourcesResponse
	goals: ViewGoal[]
	defaults: { range: TimeframePreset; metric: MetricKey }
	apiRoute: string
	adminRoute: string
	/** IANA reporting timezone the day boundaries align to. */
	timezone: string
	/** Admin UI language, for number and date formatting. */
	locale: string
}

/**
 * `denied` is a value rather than a thrown error so the view can render its own
 * no-access message inside the admin template instead of redirecting a reader who is
 * already signed in.
 */
export type ViewPropsResult = { denied: true } | { denied: false; props: AnalyticsViewClientProps }

export interface ResolveViewPropsArgs {
	/** Locale to report when the request carries no i18n (page-result fallback). */
	locale?: string
}

/**
 * The goals the request's scope may see, mirroring the goals endpoint exactly: no scope
 * parameter, an unresolvable scope on a scoped install fails closed unless `platformRead`
 * lifts it, and a failed resolution falls back to the config goals only when unscoped.
 */
const resolveGoalsList = async (
	runtime: AnalyticsRuntime,
	req: PayloadRequest,
	allowed: PlatformReadGate
): Promise<ViewGoal[]> => {
	const configGoals = (): ViewGoal[] =>
		(runtime.goals ?? []).map((goal) => ({ slug: goal.slug, name: goal.name }))
	try {
		const scope = await resolveScopeFor(runtime, req)
		if (runtime.scoped && scope === null && !(await allowed())) {
			return []
		}
		const resolved = await resolveGoalsDetailedFor(runtime, req, scope)
		return resolved.map(({ goal }) => ({ slug: goal.slug, name: goal.name }))
	} catch (err) {
		req.payload.logger?.warn(`analytics: view goals listing failed: ${String(err)}`)
		return runtime.scoped ? [] : configGoals()
	}
}

const resolveViewTimezone = async (
	runtime: AnalyticsRuntime,
	req: PayloadRequest
): Promise<string> => {
	try {
		return await resolveTimezoneFor(runtime, req)
	} catch {
		return DEFAULT_TIMEZONE
	}
}

/**
 * Resolves the client shell's props for one request. Split from the server component so the
 * whole resolution (access, scope gating, sources, goals, timezone) is testable without a
 * React render.
 */
export const resolveViewProps = async (
	req: PayloadRequest,
	resolved: ResolvedOptions,
	args: ResolveViewPropsArgs = {}
): Promise<ViewPropsResult> => {
	if (!(await resolved.access.view({ req }))) {
		return { denied: true }
	}
	// `false` cannot reach a render (the view is then never registered); it defaults anyway.
	const view = resolved.view === false ? DEFAULT_VIEW : resolved.view
	const runtime = getRuntime(req.payload)
	const base = {
		defaults: { range: view.defaultRange, metric: view.defaultMetric },
		apiRoute: req.payload.config.routes?.api ?? '/api',
		adminRoute: req.payload.config.routes?.admin ?? '/admin',
		locale: req.i18n?.language ?? args.locale ?? 'en',
	}
	// No runtime means onInit has not run (or the plugin is disabled): nothing is readable.
	if (!runtime) {
		return {
			denied: false,
			props: {
				...base,
				sources: { defaultId: null, sources: [] },
				goals: [],
				timezone: DEFAULT_TIMEZONE,
			},
		}
	}
	const allowed = platformReadGate(runtime, req)
	const [sources, goals, timezone] = await Promise.all([
		resolveSourcesForRequest(req, { platformRead: allowed }),
		resolveGoalsList(runtime, req, allowed),
		resolveViewTimezone(runtime, req),
	])
	return {
		denied: false,
		props: {
			...base,
			sources: { defaultId: sources.defaultId, sources: sources.sources },
			goals,
			timezone,
		},
	}
}
