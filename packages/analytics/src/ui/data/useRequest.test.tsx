import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { QueryFetchError } from './request'
import {
	type RequestState,
	type RunContext,
	type UseRequestOptions,
	useRequest,
} from './useRequest'

interface Call {
	key: string | null
	context: RunContext
	resolve: (value: string) => void
	reject: (err: unknown) => void
}

let calls: Call[] = []
let latest: RequestState<string> | null = null

const Probe = ({
	requestKey,
	...rest
}: Omit<UseRequestOptions<string>, 'run' | 'key'> & { requestKey: string | null }) => {
	latest = useRequest<string>({
		...rest,
		key: requestKey,
		run: (context) =>
			new Promise<string>((resolve, reject) => {
				calls.push({ key: requestKey, context, resolve, reject })
			}),
	})
	return null
}

const settle = async (call: Call | undefined, value: string) => {
	await act(async () => {
		call?.resolve(value)
	})
}

beforeEach(() => {
	calls = []
	latest = null
})

afterEach(() => {
	cleanup()
})

describe('useRequest keying', () => {
	it('reads once per key, and not again for a render that leaves it alone', async () => {
		const { rerender } = render(<Probe requestKey="a" keep="native" />)
		expect(calls.map((call) => call.key)).toEqual(['a'])
		expect(latest?.status).toBe('loading')
		expect(latest?.data).toBeUndefined()

		await settle(calls[0], 'answer-a')
		rerender(<Probe requestKey="a" keep="native" />)
		expect(calls).toHaveLength(1)
		expect(latest?.status).toBe('ok')
		expect(latest?.data).toBe('answer-a')
	})

	it('aborts the read in flight when the key moves on, and ignores its late answer', async () => {
		const { rerender } = render(<Probe requestKey="a" keep="native" />)
		rerender(<Probe requestKey="b" keep="native" />)
		expect(calls.map((call) => call.key)).toEqual(['a', 'b'])
		expect(calls[0]?.context.signal.aborted).toBe(true)
		expect(calls[1]?.context.signal.aborted).toBe(false)

		await settle(calls[1], 'answer-b')
		await settle(calls[0], 'answer-a')
		expect(latest?.data).toBe('answer-b')
	})

	it('aborts the read in flight on unmount', () => {
		const { unmount } = render(<Probe requestKey="a" keep="native" />)
		unmount()
		expect(calls[0]?.context.signal.aborted).toBe(true)
	})

	it('reads nothing for a null key and says the section is unsupported', () => {
		render(<Probe requestKey={null} keep="native" />)
		expect(calls).toHaveLength(0)
		expect(latest?.status).toBe('error')
		expect(latest?.error).toEqual({ code: 'unsupported' })
	})
})

describe('useRequest previous answer', () => {
	it('keeps the last answer on screen while the next read for the same thing runs', async () => {
		const { rerender } = render(<Probe requestKey="a" keep="native" />)
		await settle(calls[0], 'answer-a')

		rerender(<Probe requestKey="b" keep="native" />)
		expect(latest?.status).toBe('loading')
		expect(latest?.data).toBe('answer-a')
		expect(latest?.isRefetching).toBe(true)
	})

	it('drops the last answer in the very render that reads for something else', async () => {
		const { rerender } = render(<Probe requestKey="native-30d" keep="native" />)
		await settle(calls[0], 'native numbers')

		rerender(<Probe requestKey="plausible-30d" keep="plausible" />)
		expect(latest?.status).toBe('loading')
		expect(latest?.data).toBeUndefined()
		expect(latest?.isRefetching).toBe(false)

		await act(async () => {
			calls[1]?.reject(
				new QueryFetchError(502, {
					code: 'source_misconfigured',
					message: 'refused',
					param: 'host',
				})
			)
		})
		expect(latest?.status).toBe('error')
		expect(latest?.data).toBeUndefined()
		expect(latest?.error).toEqual({ code: 'source_misconfigured', hostRefused: true })
	})

	it('reports a failed refetch beside the answer it had, typed by its code', async () => {
		render(<Probe requestKey="a" keep="native" />)
		await settle(calls[0], 'answer-a')

		act(() => {
			latest?.refetch()
		})
		expect(calls).toHaveLength(2)
		expect(latest?.isRefetching).toBe(true)
		await act(async () => {
			calls[1]?.reject(new QueryFetchError(503, { code: 'unavailable', message: 'busy' }, 30))
		})
		expect(latest?.status).toBe('error')
		expect(latest?.data).toBe('answer-a')
		expect(latest?.error).toEqual({ code: 'unavailable', retryAfter: 30 })
		expect(latest?.isRefetching).toBe(false)
	})

	it('recovers on refetch after a failure', async () => {
		render(<Probe requestKey="a" keep="native" />)
		await act(async () => {
			calls[0]?.reject(new TypeError('fetch failed'))
		})
		expect(latest?.error).toEqual({ code: 'failed' })

		act(() => {
			latest?.refetch()
		})
		await settle(calls[1], 'answer-a')
		expect(latest?.status).toBe('ok')
		expect(latest?.error).toBeUndefined()
	})
})

describe('useRequest seed', () => {
	it('shows a fresh seed and reads nothing', () => {
		render(<Probe requestKey="a" keep="native" seed={{ key: 'a', data: 'from the server' }} />)
		expect(calls).toHaveLength(0)
		expect(latest?.status).toBe('ok')
		expect(latest?.data).toBe('from the server')
	})

	it('reads a stale seed again quietly, and keeps it when that fails', async () => {
		render(<Probe requestKey="a" keep="native" seed={{ key: 'a', data: 'kept', stale: true }} />)
		expect(calls).toHaveLength(1)
		expect(calls[0]?.context.revalidating).toBe(true)
		expect(latest?.status).toBe('ok')
		expect(latest?.isRefetching).toBe(false)

		await act(async () => {
			calls[0]?.reject(new QueryFetchError(503))
		})
		expect(latest?.status).toBe('ok')
		expect(latest?.data).toBe('kept')
	})

	it('replaces a stale seed with what the background read answers', async () => {
		render(<Probe requestKey="a" keep="native" seed={{ key: 'a', data: 'old', stale: true }} />)
		await settle(calls[0], 'new')
		expect(latest?.data).toBe('new')
	})

	it('reads normally once the key leaves the seed behind', async () => {
		const { rerender } = render(
			<Probe requestKey="a" keep="native" seed={{ key: 'a', data: 'seeded' }} />
		)
		rerender(<Probe requestKey="b" keep="native" seed={{ key: 'a', data: 'seeded' }} />)
		expect(calls.map((call) => [call.key, call.context.revalidating])).toEqual([['b', false]])
		rerender(<Probe requestKey="a" keep="native" seed={{ key: 'a', data: 'seeded' }} />)
		expect(calls.map((call) => call.key)).toEqual(['b', 'a'])
	})
})

describe('useRequest with a run that changes every render', () => {
	it('runs the run of the render that issued the read', async () => {
		const seen: string[] = []
		const Changing = ({ k }: { k: string }) => {
			latest = useRequest<string>({
				key: k,
				run: () => {
					seen.push(k)
					return Promise.resolve(k)
				},
			})
			return null
		}
		const { rerender } = render(<Changing k="a" />)
		await act(async () => {})
		rerender(<Changing k="b" />)
		await act(async () => {})
		expect(seen).toEqual(['a', 'b'])
		expect(latest?.data).toBe('b')
	})
})
