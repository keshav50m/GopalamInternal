# Polki jewellery

Select Polki from the category selector or open `/polki/scanner` after signing in. Scanner, Dashboard, Image Catalogue, and Custom Search use dedicated `/api/polki` endpoints and `polkiProducts` / `polkiImageCatalogue` collections. Authentication, admin settings, image hosting, and provider selection are shared. Interactive Catalogue is excluded.

QR values are comma-separated in this exact order:

`BARCODE, ITEM, LOT NO., PUWAI, NET WT., GROSSWT., TAG, LABOUR PER GRM, LABOUR + PUWAI, SILVER, FINAL`

Values are retained from the QR; no unconfirmed pricing formula is applied. The Casting price and USD discount controls correspond to Polki Final and Silver. All eleven fields appear in the scanner and exports. The five PDF layouts retain Casting's structure (including the image-only and grouped quantity layouts), with Polki labels in layouts containing product details.

## Bounds

- Scanner displays 50 rows per page; totals, export, filtering, and saves cover the full selection.
- JSON saves use batches of 500; QR updates use batches of 100. Lookup requests contain at most 1,000 combined barcode/item keys. The client splits large requests and merges responses.
- Product-list and custom-search endpoints return at most 100 rows per page. Missing-image lists return at most 150 rows per page.
- Image-catalogue workbook uploads accept up to 1,000 entries / 8 MB per workbook. Split larger workbooks. Scanner barcode/QR imports use automatic request batching.
- Images are resized to a maximum 1,600 pixels on the longest edge. At most three uploads run concurrently; uploads time out after 60 seconds.
- PDF image fetch and decode operations time out after 12 seconds each. Exports process at most 200 products per document, preload only that document's images, and release caches between parts. Large exports download numbered PDF parts; browsers may ask to allow multiple downloads. Layout 5 groups quantities across the complete selection before splitting.
- Text search uses normalized, indexed suffix arrays to preserve case-insensitive contains matching. Numeric search uses stored numeric fields. Text identities are limited to 128 characters at write boundaries. Missing-image reporting uses stored `hasImage`; dashboard counts use that field and indexed dates. Distribution aggregation groups the stored lot field rather than converting raw values during reads.

Indexes are created on first authenticated access. No Casting data is migrated into Polki.

## Verification

- `npm run test:polki`: QR positions, normalization, chunk bounds at 1,000 / 5,000 / 10,000 rows, failed-export cleanup, 10,000-key batching, PDF timeouts/cache bounds, image resizing, and upload concurrency.
- `npm run test:polki-pdf`: generates all five real PDF layouts without images in a temporary directory. This checks rendering execution, not browser layout or image-memory behavior.
- `PERF_MONGO_URI=... npm run benchmark:polki`: loads 1,000 / 5,000 / 10,000 fixtures into a unique disposable test database, checks query plans for collection scans, and prints query timing and examined-key/document counts. The scratch database is dropped afterward. Use a test MongoDB server.
- `npx tsc --noEmit --incremental false`: type check.

Live API latency, MongoDB query plans, browser memory with real images, visual PDF comparison, and authenticated browser workflows require a configured test deployment and remain release checks. The current environment has no configured `MONGO_URI`, so a production build compiles but cannot collect server page data. The synthetic scale checks establish bounded batch sizes; they are not a claim of measured browser or database performance.
