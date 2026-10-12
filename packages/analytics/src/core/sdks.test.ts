import type { BetaAnalyticsDataClient } from '@google-analytics/data'
import type { open } from 'maxmind'
import { describe, expect, it } from 'vitest'
import type { Ga4Config } from '../adapters/ga4/ga4'
import type { AnalyticsPluginOptions } from './options'
import { type AnalyticsSdks, type Ga4ClientOptions, type Ga4Sdk, resolveSdks } from './sdks'

/** Type-only: the call compiles exactly when `value` is assignable to `T`. */
const accepts = <T>(_value: T): void => undefined

declare const installed: { BetaAnalyticsDataClient: typeof BetaAnalyticsDataClient }
declare const installedMaxmind: { open: typeof open }
declare const clientOptions: Ga4ClientOptions

describe('sdks types', () => {
	it('accept the installed @google-analytics/data class wherever the docs pass it', () => {
		const check = () => {
			accepts<Ga4Sdk>(installed)
			accepts<AnalyticsSdks>({ ga4: installed, maxmind: installedMaxmind })
			accepts<NonNullable<AnalyticsPluginOptions['sdks']>>({ ga4: installed })
			accepts<NonNullable<Ga4Config['sdk']>>(installed)
			accepts<ConstructorParameters<typeof BetaAnalyticsDataClient>[0]>(clientOptions)
		}
		expect(check).toBeTypeOf('function')
	})
})

describe('resolveSdks', () => {
	it('keeps a class shaped like the SDK and refuses anything else', () => {
		class BetaAnalyticsDataClientLike {
			runReport() {
				return Promise.resolve([])
			}
		}
		expect(resolveSdks({ ga4: { BetaAnalyticsDataClient: BetaAnalyticsDataClientLike } })).toEqual({
			ga4: { BetaAnalyticsDataClient: BetaAnalyticsDataClientLike },
		})
		expect(() => resolveSdks({ ga4: {} })).toThrow(/BetaAnalyticsDataClient/)
	})
})
