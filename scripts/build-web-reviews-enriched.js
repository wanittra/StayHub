const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');
const { createMockReview, csvValue, readExistingWebReviews } = require('./reviewMockUtils');

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const rawPath = path.join(projectRoot, 'file', 'reviews.csv');
  const enrichedPath = path.join(projectRoot, 'data', 'web-reviews-enriched.csv');
  const storePath = path.join(projectRoot, 'data', 'web-reviews.json');
  const legacyPath = path.join(projectRoot, 'data', 'local-reviews.json');
  const input = readline.createInterface({ input: fs.createReadStream(rawPath), crlfDelay: Infinity });
  const output = fs.createWriteStream(enrichedPath, { encoding: 'utf8' });
  output.write('listing_id,date,rating,comment,reviewer_masked,created_at,data_source\n');
  const latestByListing = new Map();
  const occurrenceByListing = new Map();
  let first = true;
  let total = 0;

  for await (const line of input) {
    if (first) { first = false; continue; }
    const comma = line.indexOf(',');
    if (comma < 1) continue;
    const listingId = line.slice(0, comma).trim();
    const date = line.slice(comma + 1).trim();
    if (!listingId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const index = occurrenceByListing.get(listingId) || 0;
    occurrenceByListing.set(listingId, index + 1);
    const review = createMockReview(listingId, date, index);
    const excelCreatedAt = review.created_at.slice(0, 19).replace('T', ' ');
    const row = [review.listing_id, review.date, review.rating, review.comment, review.reviewer.name, excelCreatedAt, review.data_source]
      .map(csvValue).join(',');
    if (!output.write(`${row}\n`)) await new Promise((resolve) => output.once('drain', resolve));
    const latest = latestByListing.get(listingId) || [];
    latest.push(review);
    latest.sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (latest.length > 3) latest.shift();
    latestByListing.set(listingId, latest);
    total += 1;
  }
  await new Promise((resolve, reject) => { output.on('error', reject); output.end(resolve); });

  const existing = [
    ...(await readExistingWebReviews(storePath)),
    ...(await readExistingWebReviews(legacyPath)),
  ];
  const byRequestId = new Map();
  for (const reviews of latestByListing.values()) {
    reviews.forEach((review) => byRequestId.set(review.request_id, review));
  }
  existing.forEach((review) => byRequestId.set(review.request_id, review));
  const reviews = [...byRequestId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
  await fsp.mkdir(path.dirname(storePath), { recursive: true });
  await fsp.writeFile(storePath, `${JSON.stringify({ version: 2, reviews }, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ total_enriched_rows: total, cached_reviews: reviews.length, enrichedPath, storePath })}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
