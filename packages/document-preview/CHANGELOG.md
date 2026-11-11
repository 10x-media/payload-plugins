# @10x-media/document-preview

## 4.0.0-alpha.1

### Major Changes

- Payload 4 support, on Next.js and TanStack Start. The preview moves into Payload 4's file panel: the plugin renders its viewers through the collection's `upload.admin.components.filePreview`, so the edit view shows the file without a click. The `display` option is removed, and with it the Preview button beside Save, the inline preview above the fields and their `DocumentPreviewButton` and `DocumentPreviewInlineField` exports. Images, video, audio and PDF are left to Payload's own previews in the panel by default; the new `nativePreviews: false` (on the plugin or a collection) keeps the plugin's viewers for them, and a host viewer for one of these types takes the panel either way. A `filePreview` the collection sets itself is kept: a single component as is, a map with the plugin's entries added for the types it leaves open. The list column's drawer is as wide as the file panel and held to the window. Toolbars use Payload's ghost buttons and icons, sheet tabs are Payload buttons, and every surface uses Payload 4's tokens. The package declares its CSS as side effects, so bundlers keep the stylesheets. Requires Payload `4.0.0-beta.7`. See Upgrading to Payload 4 in the docs.

## 0.1.0-beta.0

### Minor Changes

- Initial beta of `@10x-media/document-preview`: read-only previews of upload documents in the Payload admin.

  - **Viewers**: images with zoom and pan, native video and audio, PDF through the browser's viewer, CSV and TSV virtualized on both axes, text and code in Payload's code editor, rendered Markdown, and Word, Excel and PowerPoint through extend's WebAssembly renderers. Each loads on first open of its format.
  - **Surfaces**: a drawer from a Preview button beside the document controls, an inline preview above the fields, a list view column, and `DocumentPreview` and `PreviewDrawer` for custom components.
  - **Custom viewers**: per mime pattern, per collection or global, resolved from the import map through an admin provider.
  - **File icons**: file-type icons for non-image thumbnails, merged after Payload's own `thumbnailURL` hook so image sizes and storage adapters keep precedence, with host icons and a signed-in-only endpoint.
  - **Readable file sizes** in the list view, and translations in eleven locales.
