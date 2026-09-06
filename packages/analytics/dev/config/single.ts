import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { devMemoryAdapter } from '../helpers/adapters'
import {
	DEV_REPORTING_TIMEZONE,
	type DevConfigFragment,
	sharedBindings,
	sharedDashboardLayout,
	sharedWidgets,
} from './shared'

/** Today's single-site dev playground: one install, no tenancy plugin. */
export const singleFragment: DevConfigFragment = {
	collections: [],
	plugins: [
		analytics({
			adapters: [native(), devMemoryAdapter],
			cache: { warm: true },
			// Surface analytics-daily in the dev nav so the sync tier is inspectable
			// (hidden by default in real installs).
			sync: { hidden: false },
			reportingTimezone: DEV_REPORTING_TIMEZONE,
			collections: sharedBindings,
			providers: { collection: true },
			widgets: sharedWidgets,
		}),
	],
	dashboard: { widgets: [], defaultLayout: sharedDashboardLayout },
}
