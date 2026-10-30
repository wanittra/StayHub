const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');

function isoDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const day = String(value.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const text = String(value ?? '').trim();
  const matched = text.match(/^\d{4}-\d{2}-\d{2}/);
  return matched ? matched[0] : '';
}

async function main() {
  const workbookPath = path.resolve(__dirname, '../file/StayHub_final.xlsx');
  const outputPath = path.resolve(__dirname, '../file/reviews.csv');
  const temporaryPath = `${outputPath}.tmp`;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  const sheet = workbook.getWorksheet('web_reviews');
  if (!sheet) throw new Error('ไม่พบชีต web_reviews');

  const output = fs.createWriteStream(temporaryPath, { encoding: 'utf8' });
  output.write('listing_id,date\n');
  let exported = 0;
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const listingId = String(row.getCell(1).value ?? '').trim();
    const date = isoDate(row.getCell(2).value);
    if (!listingId || !date) continue;
    if (!output.write(`${listingId},${date}\n`)) {
      await new Promise((resolve) => output.once('drain', resolve));
    }
    exported += 1;
  }
  await new Promise((resolve, reject) => {
    output.on('error', reject);
    output.end(resolve);
  });
  fs.renameSync(temporaryPath, outputPath);
  process.stdout.write(`${JSON.stringify({ exported, outputPath })}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
