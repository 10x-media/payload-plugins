/**
 * Every int spec delivers to an http sink on 127.0.0.1, which the default URL policy refuses on
 * both counts. Spread into `delivery`.
 */
export const LOCAL_SINK = { allowHttp: true, allowPrivateAddresses: true } as const
