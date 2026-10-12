/**
 * The packages a docs example imports that no workspace package installs, declared only as far as
 * the examples use them.
 */

declare module 'ioredis' {
	export default class Redis {
		constructor(url?: string)
		get(key: string): Promise<string | null>
		set(key: string, value: string, ...options: Array<string | number>): Promise<'OK' | null>
		zadd(key: string, score: number, member: string): Promise<number>
		zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number>
		zrevrangebyscore(
			key: string,
			max: number | string,
			min: number | string,
			...options: Array<string | number>
		): Promise<string[]>
	}
}

declare module '@c15t/nextjs/headless' {
	export function useConsentManager(): {
		consents: Record<string, boolean>
		hasConsented(): boolean
		isLoadingConsentInfo: boolean
	}
}

declare module '@c15t/nextjs' {
	import type { ReactNode } from 'react'

	export function ConsentManagerProvider(props: {
		options: Record<string, unknown>
		children?: ReactNode
	}): ReactNode
	export function CookieBanner(): ReactNode
}
