import { onRelease } from '@10x-media/payload-test-harness/release'
import { settleAnalytics } from '../../src/exports/testing'

/**
 * Lets background analytics work (cache writes, maintenance, write buffer) settle before the
 * harness destroys an instance, so no SQLite statement still runs when a test file's worker ends.
 */
onRelease(settleAnalytics)
