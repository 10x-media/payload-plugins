/**
 * msw over the global fetch alone, which is all these specs stub. `msw/node` also patches
 * `http.request`, and on Linux its passthrough breaks testcontainers' Docker API calls (write EPIPE)
 * when `TEST_DB=container` boots a database while it listens.
 */
export { setupServer } from 'msw/native'
