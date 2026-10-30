import fs from 'node:fs/promises';

const artifactModule = 'file:///C:/Users/fern/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs';
const { FileBlob, SpreadsheetFile } = await import(artifactModule);

const inputPath = new URL('../file/StayHub_final.xlsx', import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, '$1');
const previewPath = new URL('../mock-review-sheet-preview.png', import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, '$1');
const temporaryPath = `${inputPath}.mock-review.tmp.xlsx`;
const mode = process.argv[2] || 'inspect';

const input = await FileBlob.load(inputPath);
const workbook = await SpreadsheetFile.importXlsx(input);

if (mode === 'inspect') {
  const summary = await workbook.inspect({
    kind: 'sheet,table',
    maxChars: 8000,
    tableMaxRows: 4,
    tableMaxCols: 8,
  });
  const preview = await workbook.render({ sheetName: 'web_reviews', range: 'A1:F12', scale: 1.5, format: 'png' });
  await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));
  process.stdout.write(`${summary.ndjson}\nPREVIEW=${previewPath}\n`);
  process.exit(0);
}

if (mode !== 'edit') throw new Error(`Unsupported mode: ${mode}`);

let sheet;
try {
  sheet = workbook.worksheets.getItem('mock_review_templates');
} catch {
  sheet = workbook.worksheets.add('mock_review_templates');
}

const rows = [
  ['Mock_ID', 'Rating', 'Review_Text', 'Reviewer_Prefix', 'Time_Window', 'Included_In_Analysis'],
  ['MR01', 5, 'ห้องพักสะอาดและบรรยากาศโดยรวมดี เดินทางค่อนข้างสะดวก', 'ผู้เข้าพัก •••', '08:00-21:59', false],
  ['MR02', 4, 'ที่พักตรงกับรายละเอียด เหมาะสำหรับพักผ่อนและเดินทางในกรุงเทพฯ', 'ผู้เข้าพัก •••', '08:00-21:59', false],
  ['MR03', 4, 'ทำเลดี ใกล้ร้านอาหาร ห้องเป็นสัดส่วนและดูแลเรียบร้อย', 'ผู้เข้าพัก •••', '08:00-21:59', false],
  ['MR04', 5, 'การเช็กอินสะดวก ที่พักเงียบและเป็นส่วนตัวกว่าที่คาดไว้', 'ผู้เข้าพัก •••', '08:00-21:59', false],
  ['MR05', 3, 'พื้นที่ใช้งานกำลังดี อุปกรณ์พื้นฐานครบ และเดินทางไม่ยุ่งยาก', 'ผู้เข้าพัก •••', '08:00-21:59', false],
  ['MR06', 3, 'ประสบการณ์โดยรวมดี เหมาะกับการพักระยะสั้นและท่องเที่ยวในเมือง', 'ผู้เข้าพัก •••', '08:00-21:59', false],
  ['MR07', 4, 'ห้องดูเป็นระเบียบ บรรยากาศสบาย และเจ้าของให้ข้อมูลชัดเจน', 'ผู้เข้าพัก •••', '08:00-21:59', false],
  ['MR08', 5, 'ชอบทำเลและความเป็นส่วนตัว โดยรวมถือว่าคุ้มค่ากับการเข้าพัก', 'ผู้เข้าพัก •••', '08:00-21:59', false],
];

sheet.getRange('A1:F20').clear({ applyTo: 'all' });
sheet.getRange('A1:F9').values = rows;
sheet.getRange('A1:F9').format.font = { name: 'Arial', size: 10, color: '#25332D' };
sheet.getRange('A1:F1').format = {
  fill: '#0F6F5B',
  font: { name: 'Arial', size: 10, bold: true, color: '#FFFFFF' },
  horizontalAlignment: 'center',
  verticalAlignment: 'center',
};
sheet.getRange('A2:F9').format.verticalAlignment = 'center';
sheet.getRange('A2:A9').format.horizontalAlignment = 'center';
sheet.getRange('B2:B9').format.horizontalAlignment = 'center';
sheet.getRange('D2:F9').format.horizontalAlignment = 'center';
sheet.getRange('A1:F9').format.borders = { preset: 'outside', style: 'thin', color: '#C8D8D2' };
sheet.getRange('A2:F9').format.borders = { insideHorizontal: { style: 'thin', color: '#E2EBE7' } };
sheet.getRange('A1:A9').format.columnWidth = 12;
sheet.getRange('B1:B9').format.columnWidth = 10;
sheet.getRange('C1:C9').format.columnWidth = 58;
sheet.getRange('D1:D9').format.columnWidth = 20;
sheet.getRange('E1:E9').format.columnWidth = 18;
sheet.getRange('F1:F9').format.columnWidth = 23;
sheet.getRange('C2:C9').format.wrapText = true;
sheet.getRange('A1:F1').format.rowHeight = 24;
sheet.getRange('A2:F9').format.rowHeight = 36;
sheet.freezePanes.freezeRows(1);
sheet.showGridLines = false;
sheet.tabColor = '#D9A321';

workbook.recalculate();
const check = await workbook.inspect({
  kind: 'region',
  sheetId: 'mock_review_templates',
  range: 'A1:F9',
  maxChars: 12000,
});
const errors = await workbook.inspect({
  kind: 'match',
  searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',
  options: { useRegex: true, maxResults: 100 },
  summary: 'formula error scan after mock review sheet edit',
});
const preview = await workbook.render({ sheetName: 'mock_review_templates', range: 'A1:F9', scale: 1.5, format: 'png' });
await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(temporaryPath);
await fs.rename(temporaryPath, inputPath);
process.stdout.write(`${check.ndjson}\n${errors.ndjson}\nPREVIEW=${previewPath}\nOUTPUT=${inputPath}\n`);
