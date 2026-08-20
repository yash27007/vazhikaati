import { db } from '../db/client';
import { generateMockGtfsFeed } from './generateMockGtfs';
import { ingestGtfsFeed } from './gtfs';

async function main() {
  const feedDir = process.argv[2] ?? 'mock-gtfs-feed';

  console.log(`Generating mock GTFS feed at ${feedDir}/...`);
  generateMockGtfsFeed(feedDir);

  console.log(`Ingesting GTFS feed from ${feedDir}/...`);
  const result = await ingestGtfsFeed(db, feedDir);
  console.log(`  ${result.rowsProcessed} stop_times rows imported, ${result.rowsRejected} rejected.`);
  for (const r of result.rejections) {
    console.log(`    row ${r.row}: ${r.reason}`);
  }
  console.log('Done.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
