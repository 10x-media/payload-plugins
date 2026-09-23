---
'@10x-media/fields': minor
---

Add `phoneNumberField()`: an international phone number field with a searchable country picker, live as-you-type formatting, and validation and metadata sized to the install via `libphonenumber-js`.

- Two storage shapes: `storage: 'object'` (default) is a `group` of `number` + `country`, plus five `virtual: true` subfields (`national`, `international`, `callingCode`, `uri`, `type`) recomputed on every read by a single `afterRead` hook; `storage: 'e164'` is a plain `text` field holding the E.164 string alone. Virtual subfields can't be queried or sorted; filter and sort on `number` or `country` instead.
- Three validation modes (`'possible'`, `'valid'`, `'mobile'`) and three metadata sets (`'max'`, `'min'`, `'mobile'`) trading bundle size for classification detail. `validation: 'mobile'` needs metadata `'max'` or `'mobile'`; pairing it with `'min'` is rejected as a configuration error rather than silently failing every number, at plugin build time when set on the plugin and at validation time when set on a field.
- Country handling: `countries` scopes the picker without restricting what parses, validates, and saves; `preferredCountries` pins a subset above the alphabetized rest; `defaultCountry` seeds the picker and calling-code prefix.
- Flag artwork: `flags: 'svg'` (default) serves real country flags from a new, unauthenticated `/10x-fields/flags/:code` endpoint; `'emoji'` draws a Unicode regional-indicator pair instead (renders as two separate letters on Windows, which ships no flag emoji font); `'none'` shows the ISO code. `fields({ phoneNumber: { serveFlags: false } })` skips mounting the endpoint.
- `fields({ phoneNumber: {...} })` sets install-wide defaults (`defaultCountry`, `countries`, `preferredCountries`, `validation`, `flags`, `cellFormat`, `metadata`, `serveFlags`); a field's own option always wins.
- `@10x-media/fields/phone/utils` exports the parsing, formatting, and validation engine standalone for frontend use (`parsePhone`, `formatPhone`, `phoneUri`, `detectCountry`, `salvagePhone`, `checkPhone`, `formatAsYouType`, `countryOptions`, `emojiFlag`, `isKnownCountry`, `isSupported`, `loadMetadata`).

Additive: new phone number field family; no changes to any existing field, option, export, or storage shape.
