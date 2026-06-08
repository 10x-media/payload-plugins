export interface Geo {
	country?: string
	region?: string
	city?: string
}

export type GeoResolver = (headers: Headers) => Geo

export const platformHeaderResolver: GeoResolver = (headers) => ({
	country: headers.get('x-vercel-ip-country') ?? headers.get('cf-ipcountry') ?? undefined,
	region: headers.get('x-vercel-ip-country-region') ?? undefined,
	city: headers.get('x-vercel-ip-city') ?? undefined,
})

export const noopResolver: GeoResolver = () => ({})
