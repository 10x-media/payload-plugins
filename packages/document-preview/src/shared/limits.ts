const MB = 1024 * 1024

/** Largest plain-text file rendered; past this a `<pre>` stalls the tab. */
export const TEXT_MAX_BYTES = 2 * MB

/** Largest CSV parsed; rows are virtualized, but parsing is in-memory. */
export const CSV_MAX_BYTES = 20 * MB

/** Largest office document (docx, xlsx, pptx) fetched into the browser. */
export const OFFICE_MAX_BYTES = 50 * MB
