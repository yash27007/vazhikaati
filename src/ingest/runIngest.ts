import { db } from '../db/client';
import { ingestSetcCsv } from './setcCsv';
import { ingestDemoCorridor } from './demoCorridor';

async function main() {
  const csvPath = process.argv[2] ?? 'SETCbustimings_1_0.csv';
  console.log(`Ingesting SETC CSV from ${csvPath}...`);
  const result = await ingestSetcCsv(db, csvPath);
  console.log(`  ${result.rowsProcessed} rows imported, ${result.rowsRejected} rejected.`);
  for (const r of result.rejections) {
    console.log(`    row ${r.row}: ${r.reason}`);
  }

  console.log('Ingesting synthetic demo corridor...');
  await ingestDemoCorridor(db);
  console.log('Done.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
