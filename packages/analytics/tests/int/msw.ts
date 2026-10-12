/**
 * Fails on any unmocked request except testcontainers' calls to the Docker API, which reach the
 * daemon's socket as `localhost` requests when `TEST_DB=container`.
 */
export const strictUnhandled = (request: Request, print: { error: () => void }): void => {
	if (new URL(request.url).hostname !== 'localhost') {
		print.error()
	}
}
