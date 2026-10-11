# Release notes

Previews open in a **drawer** beside the document controls, or *inline* above the fields.

## Viewers

| Format | Viewer | Loaded on open |
| --- | --- | ---: |
| PDF | Browser iframe | 1 KB |
| CSV / TSV | Virtualized table | 15 KB |
| DOCX | extend | ~750 KB |
| XLSX | extend | ~2.3 MB |
| PPTX | extend | ~430 KB |

## Checklist

- [x] Lazy-load every viewer
- [x] Keep documents light in the dark admin
- [x] Icons per file type in thumbnails

> Every viewer loads on first open; a page without a preview loads none of them.

```ts
documentPreview({
  collections: { media: { display: 'both', listView: true } },
})
```

Links leave the admin in a new tab: [Payload docs](https://payloadcms.com/docs). ~~Download button~~ not planned.
