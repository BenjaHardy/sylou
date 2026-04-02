

## Fix: PDF/DOCX Extraction + Delete Icon Visibility

### Issue 1: PDF extraction failure

The `pdf-parse` npm package, when imported via `esm.sh`, tries to read a local test file (`./test/data/05-versions-space.pdf`) during initialization — this is a known issue with pdf-parse. The fix is to import the inner module directly (`pdf-parse/lib/pdf-parse.js`) and pass a `Buffer` instead of `Uint8Array`, matching the pattern from the stack overflow context.

### Issue 2: DOCX extraction failure

The edge function logs show: `Could not find file in options`. Mammoth's `extractRawText({ arrayBuffer })` doesn't work correctly via the ESM bundle in Deno. The fix is to pass a `Buffer` wrapping the array buffer, using `mammoth.extractRawText({ buffer })` instead.

### Issue 3: Delete icon visibility

The trash icon uses `opacity-0 group-hover:opacity-100` but the parent `div` doesn't have the `group` class, so the hover never triggers. Fix: always show the icon but greyed out, coloring it on hover.

---

### Changes

**`supabase/functions/extract-text/index.ts`**

1. **PDF fix** (lines 76–80): Replace `pdf-parse` import with the inner module to avoid the test-file read:
   ```ts
   import pdfParse from "npm:pdf-parse@1.1.1/lib/pdf-parse.js";
   // ...
   const { Buffer } = await import("node:buffer");
   const buffer = Buffer.from(await fileData.arrayBuffer());
   const pdfData = await pdfParse(buffer);
   ```

2. **DOCX fix** (lines 87–89): Pass `buffer` instead of `arrayBuffer`:
   ```ts
   const { Buffer } = await import("node:buffer");
   const buffer = Buffer.from(await fileData.arrayBuffer());
   const result = await mammoth.extractRawText({ buffer });
   ```

**`src/components/ImportedDocumentsPanel.tsx`**

3. **Delete icon** (line 170): Remove `opacity-0 group-hover:opacity-100 hover:opacity-100` classes. Replace with always-visible but muted styling that colors on hover:
   ```tsx
   className="p-1 text-muted-foreground/40 hover:text-destructive transition-colors rounded-md"
   ```
   Also remove the `style={{ opacity: undefined }}` override on line 171.

