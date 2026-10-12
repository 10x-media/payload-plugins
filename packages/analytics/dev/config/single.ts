import { analytics } from '@10x-media/analytics'
import { native } from '@10x-media/analytics/adapters/native'
import { delayedAdapter, devMemoryAdapter } from '../helpers/adapters'
import {
	DEV_REPORTING_TIMEZONE,
	type DevConfigFragment,
	devSiteAddress,
	pagesBinding,
	sharedCustomizing,
	sharedDashboardLayout,
	sharedGate,
	sharedGoals,
	sharedRevenue,
	sharedSkip,
	sharedWidgets,
	slowSourceDashboardLayout,
	slowSourceMs,
} from './shared'

const nativeAdapter = native()
const slowMs = slowSourceMs()
const memorySource = slowMs ? delayedAdapter(devMemoryAdapter, slowMs) : devMemoryAdapter

/** The single-site dev playground: one install, no tenancy plugin. */
export const singleFragment: DevConfigFragment = {
	collections: [],
	plugins: [
		analytics({
			adapters: [nativeAdapter, memorySource],
			...(slowMs ? { defaultAdapter: memorySource.id } : {}),
			// Slowed, each opened page's sidebar stat read holds a slot for the whole delay: beside the
			// panel's three headline reads they outgrow the default four, and one would time out queued.
			cache: { warm: true, ...(slowMs ? { concurrency: { perSource: 8 } } : {}) },
			sync: true,
			reportingTimezone: DEV_REPORTING_TIMEZONE,
			revenue: sharedRevenue,
			collections: { pages: pagesBinding },
			// Two config adapters, so the global slot has to name one: the memory provider is a
			// read-only demo source with nothing to capture.
			capture: {
				slots: { global: nativeAdapter.id },
				gate: sharedGate,
				// The site is this same app, served where the admin is.
				exclusion: { sites: ({ req }) => [devSiteAddress(req)] },
				skip: sharedSkip,
			},
			goals: { defaults: sharedGoals, collection: true },
			providers: { collection: true },
			widgets: sharedWidgets,
			...sharedCustomizing,
		}),
	],
	dashboard: {
		widgets: [],
		defaultLayout: slowMs ? slowSourceDashboardLayout : sharedDashboardLayout,
	},
}
