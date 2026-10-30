-- Imported documents: the storage bucket accepts what the app uploads and
-- nothing else.
--
-- The imports bucket was created without limits (20260402103109): the
-- 10 MB cap and the accepted file types lived only in the browser
-- (useImportedDocuments). Storage now enforces both on every upload.
--
-- 1. Size. file_size_limit = 10 MB (10485760 bytes), the app's own cap,
--    checked against the bytes received. The project's global upload limit
--    still applies where it is lower.
--
-- 2. Types. allowed_mime_types = the four types the app accepts. Storage
--    compares them with the type the upload declares, not with the file's
--    content (extract-text checks that before parsing). Browsers declare no
--    type for some files (.md often), so useImportedDocuments labels each
--    upload from its extension.
--
-- Deploy order: the app that labels uploads must be live before this runs,
-- or a .md upload from a browser that declares no type is refused. Files
-- already stored are untouched. Idempotent.

UPDATE storage.buckets
SET file_size_limit = 10485760,
    allowed_mime_types = ARRAY[
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/markdown'
    ]
WHERE id = 'imports';
