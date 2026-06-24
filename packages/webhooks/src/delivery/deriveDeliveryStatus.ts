/** Delivery status from the attempt outcome. `attempt` is 1-based; total tries = maxRetries + 1. */
export const deriveDeliveryStatus = (args: {
	ok: boolean
	attempt: number
	maxRetries: number
}): 'success' | 'failed' | 'dead' => {
	if (args.ok) {
		return 'success'
	}
	return args.attempt > args.maxRetries ? 'dead' : 'failed'
}
