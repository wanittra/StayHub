const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');
const { createMockReview, csvValue, readExistingWebReviews } = require('./reviewMockUtils');

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const rawPath = path.join(projectRoot, 'file', 'reviews.csv');
  const storePath = path.join(projectRoot, 'data', 'web-reviews.json');
  const legacyPath = path.join(projectRoot, 'data', 'local-reviews.json');
  const seedPath = path.join(projectRoot, 'data', 'web-review-seed.csv');
  const mockReviews = [];
  const input = readline.createInterface({ input: fs.createReadStream(rawPath), crlfDelay: Infinity });
  let first = true;
  const latestDatesByListing = new Map();

  for await (const line of input) {
    if (first) { first = false; continue; }
    const comma = line.indexOf(',');
    if (comma < 1) continue;
    const listingId = line.slice(0, comma).trim();
    const date = line.slice(comma + 1).trim();
    if (!listingId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const latestDates = latestDatesByListing.get(listingId) || [];
    latestDates.push(date);
    if (latestDates.length > 3) latestDates.shift();
    latestDatesByListing.set(listingId, latestDates);
  }
  for (const [listingId, latestDates] of latestDatesByListing) {
    latestDates.forEach((date, index) => mockReviews.push(createMockReview(listingId, date, index, {
      dataSource: 'mock_historical',
      includeDate: false,
    })));
  }

  const existing = [
    ...(await readExistingWebReviews(storePath)),
    ...(await readExistingWebReviews(legacyPath)),
  ];
  const byRequestId = new Map();
  [...mockReviews, ...existing].forEach((review) => byRequestId.set(review.request_id, review));
  const reviews = [...byRequestId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));

  await fsp.mkdir(path.dirname(storePath), { recursive: true });
  await fsp.writeFile(storePath, `${JSON.stringify({ version: 2, reviews }, null, 2)}\n`, 'utf8');
  const headers = ['review_id', 'request_id', 'listing_id', 'reviewer_masked', 'rating', 'comment', 'created_at', 'data_source', 'is_mock'];
  const csv = fs.createWriteStream(seedPath, { encoding: 'utf8' });
  csv.write(`${headers.join(',')}\n`);
  for (const review of reviews) {
    csv.write(`${[
      review.review_id, review.request_id, review.listing_id, review.reviewer?.name || 'ผู้เข้าพัก',
      review.rating, review.comment, review.created_at, review.data_source || 'web', review.is_mock ? 'TRUE' : 'FALSE',
    ].map(csvValue).join(',')}\n`);
  }
  await new Promise((resolve, reject) => { csv.on('error', reject); csv.end(resolve); });
  process.stdout.write(`${JSON.stringify({ mock_reviews: mockReviews.length, existing_reviews: existing.length, total: reviews.length, storePath, seedPath })}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
