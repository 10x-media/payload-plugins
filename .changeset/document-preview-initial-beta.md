---
'@10x-media/document-preview': minor
---

Initial beta of `@10x-media/document-preview`: read-only previews of upload documents in the Payload admin.

- **Viewers**: images with zoom and pan, native video and audio, PDF through the browser's viewer, CSV and TSV virtualized on both axes, text and code in Payload's code editor, rendered Markdown, and Word, Excel and PowerPoint through extend's WebAssembly renderers. Each loads on first open of its format.
- **Surfaces**: a drawer from a Preview button beside the document controls, an inline preview above the fields, a list view column, and `DocumentPreview` and `PreviewDrawer` for custom components.
- **Custom viewers**: per mime pattern, per collection or global, resolved from the import map through an admin provider.
- **File icons**: file-type icons for non-image thumbnails, merged after Payload's own `thumbnailURL` hook so image sizes and storage adapters keep precedence, with host icons and a signed-in-only endpoint.
- **Readable file sizes** in the list view, and translations in eleven locales.
