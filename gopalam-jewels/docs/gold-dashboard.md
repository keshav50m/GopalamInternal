# Gold dashboard

Open `/gold/dashboard` from the Gold Scanner navigation. The authenticated `/api/gold/dashboard` endpoint reads only `savedProducts_Gold`.

The summary includes total, available and sold products, updates today and this month, the ten largest karat groups, the last fourteen days of update activity, and twelve recent products. Dates use Asia/Kolkata. Upload activity means the latest product update, not an audit history of every upload.

Search accepts `?query=` with an exact barcode or normalized uppercase lot number. It returns at most twenty records and supports legacy numeric barcodes. Search input is limited to one hundred characters. Product responses project metadata and exclude images, so image size does not inflate the dashboard response.

Indexes cover barcode, legacy data.BARCODE, lot number and recent updates. Index initialization retries after a failure. Queries have database execution time limits. The summary uses a sixty-second process-local cache and a shared in-flight promise to avoid simultaneous duplicate calculations within an instance. Responses are private and no-store; authentication runs before any cache read.

Summary counts and karat grouping still perform collection scans. The cache is not shared across server replicas. Before scaling to a large inventory or many replicas, move summaries to a persisted rollup refreshed by a scheduled job or maintained by all product mutation paths, and validate query plans and latency against production-sized data. The current limits constrain response size and repeated computation; they do not make aggregation cost independent of inventory size.
