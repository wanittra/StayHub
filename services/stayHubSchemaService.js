const fs = require('node:fs/promises');
const path = require('node:path');
const unzipper = require('unzipper');
const { SaxesParser } = require('saxes');

const INPUT_SHEET_NAME = 'user_submissions';
const INPUT_COLUMNS = [
  { key: 'Submission_ID', label: 'รหัสการส่งข้อมูล', type: 'text', description: 'รหัสอ้างอิงที่ไม่ซ้ำกัน ระบบจะสร้างค่าตั้งต้นให้' },
  { key: 'Timestamp', label: 'วันและเวลาที่ส่ง', type: 'datetime', description: 'วันและเวลาในเครื่องผู้ใช้ ระบบจะเติมค่าปัจจุบันให้' },
  { key: 'Neighbourhood', label: 'เขต', type: 'text', description: 'เลือกเขตจาก tblLookup' },
  { key: 'Room_Type', label: 'ประเภทห้อง', type: 'text', description: 'เลือกประเภทห้องที่มีใน tblLookup' },
  { key: 'Proposed_Price', label: 'ราคาที่เสนอต่อคืน', type: 'number', min: 0.01, description: 'ราคาที่ต้องการตั้งต่อคืน' },
  { key: 'Monthly_FC', label: 'ต้นทุนคงที่รายเดือน', type: 'number', min: 0, description: 'ต้นทุนคงที่ที่เกิดขึ้นต่อเดือน' },
  { key: 'PerNight_VC', label: 'ต้นทุนผันแปรต่อคืน', type: 'number', min: 0, description: 'ต้นทุนที่เกิดขึ้นต่อการเข้าพักหนึ่งคืน' },
  { key: 'Target_Profit', label: 'กำไรเป้าหมายรายเดือน', type: 'number', min: 0, description: 'กำไรที่ต้องการหลังหักต้นทุนต่อเดือน' },
  { key: 'Target_Occupancy', label: 'อัตราเข้าพักเป้าหมาย', type: 'percentage', min: 0.01, max: 1, description: 'กรอกเป็นเปอร์เซ็นต์ระหว่าง 1–100' },
];

const RESULT_COLUMNS = [
  { key: 'Market_Mean_Price', label: 'ราคาเฉลี่ยตลาด', format: 'number' },
  { key: 'Market_Median_Price', label: 'ราคามัธยฐานตลาด', format: 'number' },
  { key: 'Market_SD_Price', label: 'ส่วนเบี่ยงเบนมาตรฐานราคา', format: 'number' },
  { key: 'Market_Est_Occupancy', label: 'อัตราเข้าพักประมาณของตลาด', format: 'percentage' },
  { key: 'Price_Percentile', label: 'เปอร์เซ็นไทล์ราคา', format: 'percentage' },
  { key: 'Z_Score', label: 'Z-Score', format: 'decimal' },
  { key: 'Price_Status', label: 'สถานะราคา', format: 'text' },
  { key: 'BreakEven_Nights', label: 'จำนวนคืนคุ้มทุน', format: 'decimal' },
  { key: 'BreakEven_Occupancy', label: 'อัตราเข้าพักคุ้มทุน', format: 'percentage' },
  { key: 'GoalSeek_Target_Price', label: 'ราคาเป้าหมายที่คำนวณได้', format: 'number' },
  { key: 'Feasibility_Verdict', label: 'ผลประเมินความเป็นไปได้', format: 'text' },
];

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

function localName(name) {
  const separator = name.indexOf(':');
  return separator === -1 ? name : name.slice(separator + 1);
}

function attribute(node, name) {
  const value = node.attributes[name];
  return value && typeof value === 'object' ? value.value : value;
}

function parseRelationships(xml) {
  const relationships = new Map();
  const parser = new SaxesParser({ xmlns: false });
  parser.on('opentag', (node) => {
    if (localName(node.name) !== 'Relationship') return;
    relationships.set(attribute(node, 'Id'), attribute(node, 'Target'));
  });
  parser.write(xml).close();
  return relationships;
}

function resolveWorkbookTarget(target) {
  if (target.startsWith('/')) return target.slice(1);
  return path.posix.normalize(path.posix.join('xl', target));
}

function parseWorkbookSheets(xml, relationships) {
  const sheets = [];
  const parser = new SaxesParser({ xmlns: false });
  parser.on('opentag', (node) => {
    if (localName(node.name) !== 'sheet') return;
    const target = relationships.get(attribute(node, 'r:id'));
    if (target) sheets.push({ name: attribute(node, 'name'), entryPath: resolveWorkbookTarget(target) });
  });
  parser.write(xml).close();
  return sheets;
}

function parseSharedStrings(xml) {
  const strings = [];
  let inItem = false;
  let inText = false;
  let current = '';
  const parser = new SaxesParser({ xmlns: false });
  parser.on('opentag', (node) => {
    const name = localName(node.name);
    if (name === 'si') {
      inItem = true;
      current = '';
    } else if (inItem && name === 't') inText = true;
  });
  parser.on('text', (text) => {
    if (inItem && inText) current += text;
  });
  parser.on('closetag', (tag) => {
    const local = localName(tag.name);
    if (local === 't') inText = false;
    if (local === 'si') {
      strings.push(current);
      inItem = false;
    }
  });
  parser.write(xml).close();
  return strings;
}

function columnNumber(cellReference) {
  const letters = String(cellReference).match(/^[A-Z]+/i)?.[0]?.toUpperCase() || '';
  let number = 0;
  for (const character of letters) number = number * 26 + character.charCodeAt(0) - 64;
  return number;
}

function decodeCell(rawValue, type, sharedStrings) {
  if (rawValue === '') return null;
  if (type === 's') return sharedStrings[Number(rawValue)] ?? '';
  if (type === 'b') return rawValue === '1';
  if (type === 'inlineStr' || type === 'str') return rawValue;
  const number = Number(rawValue);
  return Number.isFinite(number) ? number : rawValue;
}

function parseWorksheet(xml, sharedStrings, { includeRows = true } = {}) {
  let dimension = null;
  let currentRow = null;
  let currentCell = null;
  let captureValue = false;
  let rawValue = '';
  let headers = [];
  const rows = [];
  const parser = new SaxesParser({ xmlns: false });

  parser.on('opentag', (node) => {
    const name = localName(node.name);
    if (name === 'dimension') dimension = attribute(node, 'ref') || null;
    if (name === 'row') currentRow = { number: Number(attribute(node, 'r') || 0), values: new Map() };
    if (name === 'c') {
      currentCell = { column: columnNumber(attribute(node, 'r')), type: attribute(node, 't') || '' };
      rawValue = '';
    }
    if (currentCell && (name === 'v' || (currentCell.type === 'inlineStr' && name === 't'))) captureValue = true;
  });

  parser.on('text', (text) => {
    if (captureValue) rawValue += text;
  });

  parser.on('closetag', (tag) => {
    const local = localName(tag.name);
    if (local === 'v' || local === 't') captureValue = false;
    if (local === 'c' && currentCell && currentRow) {
      currentRow.values.set(currentCell.column, decodeCell(rawValue, currentCell.type, sharedStrings));
      currentCell = null;
    }
    if (local === 'row' && currentRow) {
      if (currentRow.number === 1) {
        headers = [...currentRow.values.entries()]
          .filter(([, value]) => !isBlank(value))
          .map(([column, value]) => ({ name: String(value).trim(), columnNumber: column }));
      } else if (includeRows && headers.length) {
        const row = {};
        let hasValue = false;
        for (const header of headers) {
          const value = currentRow.values.get(header.columnNumber) ?? null;
          row[header.name] = value;
          if (!isBlank(value)) hasValue = true;
        }
        if (hasValue) rows.push(row);
      }
      currentRow = null;
    }
  });

  parser.write(xml).close();
  return { dimension, headers, rows };
}

function uniqueStrings(values, limit = 30) {
  const found = [];
  for (const value of values) {
    if (isBlank(value)) continue;
    const text = String(value).trim();
    if (!found.includes(text)) found.push(text);
    if (found.length > limit) return [];
  }
  return found;
}

function createSchemaService(excelPath) {
  let cache = null;
  let cachedMtime = 0;

  async function getSchema() {
    let stat;
    try {
      stat = await fs.stat(excelPath);
    } catch {
      const wrapped = new Error(`ไม่พบไฟล์ Excel ที่ ${excelPath}`);
      wrapped.code = 'EXCEL_NOT_FOUND';
      throw wrapped;
    }
    if (cache && stat.mtimeMs === cachedMtime) return cache;

    const directory = await unzipper.Open.file(excelPath);
    const entries = new Map(directory.files.map((entry) => [entry.path.replace(/\\/g, '/'), entry]));
    async function readEntry(entryPath, required = true) {
      const entry = entries.get(entryPath);
      if (!entry) {
        if (!required) return '';
        const error = new Error(`โครงสร้าง Excel ไม่สมบูรณ์: ไม่พบ ${entryPath}`);
        error.code = 'EXCEL_INVALID';
        throw error;
      }
      return (await entry.buffer()).toString('utf8');
    }

    const relationships = parseRelationships(await readEntry('xl/_rels/workbook.xml.rels'));
    const sheetDefinitions = parseWorkbookSheets(await readEntry('xl/workbook.xml'), relationships);
    const sharedXml = await readEntry('xl/sharedStrings.xml', false);
    const sharedStrings = sharedXml ? parseSharedStrings(sharedXml) : [];
    const sheetByName = new Map(sheetDefinitions.map((sheet) => [sheet.name, sheet]));
    const requiredSheetNames = ['lookup', INPUT_SHEET_NAME];
    for (const name of requiredSheetNames) {
      if (!sheetByName.has(name)) {
        const error = new Error(`ไม่พบชีต ${name} ในไฟล์อ้างอิง`);
        error.code = 'EXCEL_INVALID';
        throw error;
      }
    }

    const parsedSheets = new Map();
    for (const name of requiredSheetNames) {
      const definition = sheetByName.get(name);
      parsedSheets.set(name, {
        name,
        ...parseWorksheet(await readEntry(definition.entryPath), sharedStrings, { includeRows: name === 'lookup' }),
      });
    }

    const lookupSheet = parsedSheets.get('lookup');
    const submissionSheet = parsedSheets.get(INPUT_SHEET_NAME);
    const actualHeaders = new Set(submissionSheet.headers.map((header) => header.name));
    const requiredHeaders = [...INPUT_COLUMNS.map((field) => field.key), 'Lookup_ID', ...RESULT_COLUMNS.map((field) => field.key)];
    const missingHeaders = requiredHeaders.filter((header) => !actualHeaders.has(header));
    if (missingHeaders.length) {
      const error = new Error(`ชีต ${INPUT_SHEET_NAME} ขาดคอลัมน์: ${missingHeaders.join(', ')}`);
      error.code = 'EXCEL_INVALID';
      throw error;
    }

    const neighbourhoods = uniqueStrings(lookupSheet.rows.map((row) => row.neighbourhood), 1000).sort();
    const roomTypes = uniqueStrings(lookupSheet.rows.map((row) => row.room_type), 100).sort();
    const validPairs = lookupSheet.rows
      .filter((row) => !isBlank(row.neighbourhood) && !isBlank(row.room_type))
      .map((row) => ({ neighbourhood: String(row.neighbourhood), room_type: String(row.room_type) }));
    const fields = INPUT_COLUMNS.map((field) => ({
      ...field,
      required: true,
      hidden: false,
      options: field.key === 'Neighbourhood' ? neighbourhoods : field.key === 'Room_Type' ? roomTypes : [],
      suggestions: [],
      defaultValue: '',
    }));

    cache = {
      sourceFile: path.basename(excelPath),
      datasets: [{
        name: INPUT_SHEET_NAME,
        label: 'ประเมินราคาและจุดคุ้มทุน',
        targetSheet: INPUT_SHEET_NAME,
        targetTable: 'tblSubmissions',
        fields,
        resultFields: RESULT_COLUMNS,
        validPairs,
      }],
      lookups: { neighbourhoods, roomTypes },
      referenceSheets: [
        { name: 'lookup', rowCount: lookupSheet.rows.length, columns: lookupSheet.headers.map((header) => header.name) },
        { name: INPUT_SHEET_NAME, columns: submissionSheet.headers.map((header) => header.name) },
      ],
    };
    cachedMtime = stat.mtimeMs;
    return cache;
  }

  return { getSchema };
}

module.exports = { createSchemaService };
