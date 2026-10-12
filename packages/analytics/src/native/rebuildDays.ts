import type { Payload } from 'payload'
import { getRuntime } from '../plugin/runtime'
import type { RebuildDaysInput, RebuildDaysReport } from './engine/rebuild'
import { isNativeAdapter } from './nativeAdapter'

/**
 * Marks a stretch of native days to be recounted from raw hits by the next maintenance run or read.
 * A day older than `retention.rawDays` keeps its totals, since its raw hits may be gone.
 */
export const rebuildDays = async (
	payload: Payload,
	input: RebuildDaysInput
): Promise<RebuildDaysReport> => {
	const adapter = getRuntime(payload)?.registry.all().find(isNativeAdapter)
	if (!adapter) {
		throw new Error('analytics: rebuildDays needs the native adapter in analytics({ adapters })')
	}
	return adapter.rebuild(payload, input)
}
