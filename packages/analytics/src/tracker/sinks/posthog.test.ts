import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrackerWindow, VendorSwitch } from '../types'
import { createPosthogSink, posthogWindowIdKey } from './posthog'
import { VENDOR_GLOBAL_POLL_MS } from './vendor'

/** A loaded posthog-js client, as far as the sink calls it. */
/** Opted in or out as posthog-js keeps it: an opt-out is no longer opted in. */
const client = (optedIn = false) => {
	let opted = optedIn
	return {
		__loaded: true,
		capture: vi.fn(),
		opt_in_capturing: vi.fn(() => {
			opted = true
		}),
		opt_out_capturing: vi.fn(() => {
			opted = false
		}),
		has_opted_in_capturing: vi.fn(() => opted),
		set_config: vi.fn(),
	}
}

type Client = ReturnType<typeof client>

const pending = (mode: VendorSwitch['mode']): VendorSwitch => ({ mode, refused: false })
const refused = (mode: VendorSwitch['mode']): VendorSwitch => ({ mode, refused: true })

const sinkFor = (extra: { instance?: string; cookieless?: boolean } = {}) =>
	createPosthogSink({
		slot: extra.instance ? 'tenant' : 'global',
		win: window as TrackerWindow,
		scripts: [],
		loadScript: () => Promise.resolve(),
		token: 'phc_test',
		cookieless: true,
		...extra,
	})

const install = (value: unknown) => {
	Object.defineProperty(window, 'posthog', { value, configurable: true, writable: true })
}

beforeEach(() => {
	window.sessionStorage.clear()
})

afterEach(() => {
	Reflect.deleteProperty(window, 'posthog')
	vi.useRealTimers()
})

describe('the PostHog sink switching modes', () => {
	let sdk: Client

	beforeEach(() => {
		sdk = client()
		install(sdk)
	})

	it('opts in on consent without an $opt_in event, once', () => {
		const sink = sinkFor()
		sink.mode?.(pending('full'))
		sink.mode?.(pending('full'))
		expect(sdk.opt_in_capturing).toHaveBeenCalledTimes(1)
		expect(sdk.opt_in_capturing).toHaveBeenCalledWith({ captureEventName: false })
		expect(sdk.set_config).not.toHaveBeenCalled()
	})

	it("returns to cookieless on a revoke, leaving none of posthog-js's window id", () => {
		window.sessionStorage.setItem(posthogWindowIdKey('phc_test'), 'w1')
		window.sessionStorage.setItem('ph_other_window_id', 'w2')
		const sink = sinkFor()
		sink.mode?.(pending('full'))
		sink.mode?.(refused('cookieless'))
		expect(sdk.opt_out_capturing).toHaveBeenCalledTimes(1)
		expect(sdk.set_config).not.toHaveBeenCalled()
		expect(Object.keys(window.sessionStorage)).toEqual(['ph_other_window_id'])
	})

	it('calls nothing for a refusal before any grant, which would write PostHog its consent key', () => {
		const sink = sinkFor()
		sink.mode?.(refused('cookieless'))
		expect(sdk.opt_out_capturing).not.toHaveBeenCalled()
		expect(sdk.opt_in_capturing).not.toHaveBeenCalled()
	})

	it('opts out on a refusal while PostHog runs in full on a grant it kept from an earlier page', () => {
		sdk = client(true)
		install(sdk)
		const sink = sinkFor()
		sink.mode?.(refused('cookieless'))
		expect(sdk.opt_out_capturing).toHaveBeenCalledTimes(1)
	})

	it('leaves a kept grant alone while the gate is only pending', () => {
		sdk = client(true)
		install(sdk)
		sinkFor().mode?.(pending('cookieless'))
		expect(sdk.opt_out_capturing).not.toHaveBeenCalled()
	})

	it('stops a cookieless client entirely when off, and lets it count cookielessly again', () => {
		const sink = sinkFor()
		sink.mode?.(refused('off'))
		expect(sdk.set_config).toHaveBeenLastCalledWith({ cookieless_mode: false })
		sink.mode?.(pending('cookieless'))
		expect(sdk.set_config).toHaveBeenLastCalledWith({ cookieless_mode: 'on_reject' })
		expect(sdk.set_config).toHaveBeenCalledTimes(2)
	})

	it('writes no consent key when off before any grant, the client being opted out by default', () => {
		sinkFor().mode?.(refused('off'))
		expect(sdk.opt_out_capturing).not.toHaveBeenCalled()
	})

	it('opts out when off over a grant PostHog kept from an earlier page', () => {
		sdk = client(true)
		install(sdk)
		sinkFor().mode?.(refused('off'))
		expect(sdk.set_config).toHaveBeenCalledWith({ cookieless_mode: false })
		expect(sdk.opt_out_capturing).toHaveBeenCalledTimes(1)
	})

	it('opts out when off over a grant on this page', () => {
		const sink = sinkFor()
		sink.mode?.(pending('full'))
		sink.mode?.(refused('off'))
		expect(sdk.opt_out_capturing).toHaveBeenCalledTimes(1)
	})

	it('keeps the beta.14 switches on a strict slot', () => {
		const sink = sinkFor({ cookieless: false })
		sink.mode?.(pending('full'))
		sink.mode?.(refused('off'))
		expect(sdk.opt_in_capturing).toHaveBeenCalledTimes(1)
		expect(sdk.opt_out_capturing).toHaveBeenCalledTimes(1)
		expect(sdk.set_config).not.toHaveBeenCalled()
	})
})

describe('two PostHog clients on one page', () => {
	it('switches each on its own answers', () => {
		const tenant = client()
		const primary = Object.assign(client(), { tenant })
		install(primary)
		const global = sinkFor()
		const named = sinkFor({ instance: 'tenant' })

		named.mode?.(pending('full'))
		expect(tenant.opt_in_capturing).toHaveBeenCalledTimes(1)
		expect(primary.opt_in_capturing).not.toHaveBeenCalled()

		global.mode?.(refused('off'))
		expect(primary.set_config).toHaveBeenCalledWith({ cookieless_mode: false })
		expect(tenant.set_config).not.toHaveBeenCalled()

		named.mode?.(refused('cookieless'))
		expect(tenant.opt_out_capturing).toHaveBeenCalledTimes(1)
		expect(primary.opt_out_capturing).not.toHaveBeenCalled()
	})
})

describe('switching before posthog-js loaded', () => {
	/** The snippet's stub: the init queued for each client, which posthog-js runs once it lands. */
	const stub = () => {
		const tenant: unknown[] = []
		const queued = Object.assign([] as unknown[], {
			_i: [
				['phc_test', { cookieless_mode: 'on_reject' }, 'posthog'],
				['phc_tenant', { cookieless_mode: 'on_reject' }, 'tenant'],
			],
			tenant,
			opt_out_capturing: vi.fn(),
		})
		install(queued)
		return queued
	}

	it("turns cookieless off in the queued init of this slot's client alone", () => {
		const queued = stub()
		sinkFor().mode?.(refused('off'))
		expect(queued._i).toEqual([
			['phc_test', { cookieless_mode: false }, 'posthog'],
			['phc_tenant', { cookieless_mode: 'on_reject' }, 'tenant'],
		])
		expect(queued.opt_out_capturing).not.toHaveBeenCalled()
	})

	it('checks a refusal against a kept grant once the client loaded', async () => {
		vi.useFakeTimers()
		stub()
		sinkFor().mode?.(refused('cookieless'))
		const sdk = client(true)
		install(sdk)
		await vi.advanceTimersByTimeAsync(VENDOR_GLOBAL_POLL_MS)
		expect(sdk.opt_out_capturing).toHaveBeenCalledTimes(1)
	})

	it('keeps the refusal however long posthog-js takes to load', async () => {
		vi.useFakeTimers()
		stub()
		sinkFor().mode?.(refused('cookieless'))
		await vi.advanceTimersByTimeAsync(60_000)
		const sdk = client(true)
		install(sdk)
		await vi.advanceTimersByTimeAsync(VENDOR_GLOBAL_POLL_MS)
		expect(sdk.opt_out_capturing).toHaveBeenCalledTimes(1)
	})

	it('puts the refusal to the client the moment an event finds it loaded', () => {
		vi.useFakeTimers()
		stub()
		const sink = sinkFor()
		sink.mode?.(refused('cookieless'))
		const sdk = client(true)
		install(sdk)
		sink.send({ type: 'event', name: 'signup', path: '/', hostname: 'shop.test' })
		expect(sdk.opt_out_capturing).toHaveBeenCalledTimes(1)
		expect(sdk.opt_out_capturing.mock.invocationCallOrder[0]).toBeLessThan(
			sdk.capture.mock.invocationCallOrder[0] ?? 0
		)
	})

	it('stops waiting when the page leaves', async () => {
		vi.useFakeTimers()
		stub()
		sinkFor().mode?.(refused('cookieless'))
		window.dispatchEvent(new Event('pagehide'))
		const sdk = client(true)
		install(sdk)
		await vi.advanceTimersByTimeAsync(VENDOR_GLOBAL_POLL_MS * 3)
		expect(sdk.opt_out_capturing).not.toHaveBeenCalled()
	})
})
