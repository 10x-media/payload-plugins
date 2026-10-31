import { describe, expect, it } from 'vitest'
import { estimateUploadMinutes } from './uploadEstimate'

describe('estimating how long a dropped file will take to upload', () => {
	it('puts a 2 GB export at around half an hour on a 10 Mbps uplink', () => {
		// The brief's own worked example: this is the number that has to land
		// close to "half an hour", not exactly any particular value.
		const twoGigabytes = 2 * 1024 ** 3
		const minutes = estimateUploadMinutes(twoGigabytes)
		expect(minutes).toBeGreaterThanOrEqual(25)
		expect(minutes).toBeLessThanOrEqual(35)
	})

	it('scales roughly linearly with size at a fixed uplink', () => {
		// "Roughly": each estimate is independently rounded up to a whole
		// minute, so doubling the size does not land on exactly double the
		// minutes, it lands within a minute of it.
		const oneGigabyte = 1024 ** 3
		const twoGigabytes = oneGigabyte * 2
		const doubled = estimateUploadMinutes(oneGigabyte) * 2
		expect(Math.abs(estimateUploadMinutes(twoGigabytes) - doubled)).toBeLessThanOrEqual(1)
	})

	it('takes longer on a slower assumed uplink', () => {
		const oneGigabyte = 1024 ** 3
		const atTenMbps = estimateUploadMinutes(oneGigabyte)
		const atOneMbps = estimateUploadMinutes(oneGigabyte, 1_000_000)
		expect(atOneMbps).toBeGreaterThan(atTenMbps)
	})

	it('never reads as an instant upload for a real, if tiny, file', () => {
		expect(estimateUploadMinutes(1024)).toBe(1)
	})

	it('treats a zero or negative size as nothing to estimate', () => {
		expect(estimateUploadMinutes(0)).toBe(0)
		expect(estimateUploadMinutes(-5)).toBe(0)
	})

	it('is not thrown off by a non-finite size', () => {
		expect(estimateUploadMinutes(Number.NaN)).toBe(0)
		expect(estimateUploadMinutes(Number.POSITIVE_INFINITY)).toBe(0)
	})
})
