import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { devMemoryAdapter } from '../helpers/adapters'
import {
	DEV_REPORTING_TIMEZONE,
	type DevConfigFragment,
	sharedBindings,
	sharedDashboardLayout,
	sharedGoals,
	sharedWidgets,
} from './shared'

const nativeAdapter = native()

/** Today's single-site dev playground: one install, no tenancy plugin. */
export const singleFragment: DevConfigFragment = {
	collections: [],
	plugins: [
		analytics({
			adapters: [nativeAdapter, devMemoryAdapter],
			cache: { warm: true },
			// Surface analytics-daily in the dev nav so the sync tier is inspectable
			// (hidden by default in real installs).
			sync: { hidden: false },
			reportingTimezone: DEV_REPORTING_TIMEZONE,
			collections: sharedBindings,
			// Two config adapters, so the global slot has to name one: the memory provider is a
			// read-only demo source with nothing to capture.
			capture: { slots: { global: nativeAdapter.id } },
			goals: sharedGoals,
			providers: { collection: true },
			widgets: sharedWidgets,
		}),
	],
	dashboard: { widgets: [], defaultLayout: sharedDashboardLayout },
}
