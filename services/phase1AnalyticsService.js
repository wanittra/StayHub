const fs = require('node:fs/promises');
const path = require('node:path');
const unzipper = require('unzipper');
const { SaxesParser } = require('saxes');

const REQUIRED_SHEETS = ['Config', '3_Forecasting', '4_Optimization', '5_Integrity', 'dimensions', 'user_submissions'];

function localName(name) {
  const separator = name.indexOf(':');
  return separator === -1 ? name : name.slice(separator + 1);
}

function attribute(node, name) {
  const value = node.attributes[name];
  return value && typeof value === 'object' ? value.value : value;
}

function columnNumber(cellReference) {
  const letters = String(cellReference).match(/^[A-Z]+/i)?.[0]?.toUpperCase() || '';
  let number = 0;
  for (const character of letters) number = number * 26 + character.charCodeAt(0) - 64;
  return number;
}

function parseRelationships(xml) {
  const relationships = new Map();
  const parser = new SaxesParser({ xmlns: false });
  parser.on('opentag', (node) => {
    if (localName(node.name) === 'Relationship') {
      relationships.set(attribute(node, 'Id'), attribute(node, 'Target'));
    }
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
  parser.on('text', (text) => { if (inItem && inText) current += text; });
  parser.on('closetag', (tag) => {
    const name = localName(tag.name);
    if (name === 't') inText = false;
    if (name === 'si') {
      strings.push(current);
      inItem = false;
    }
  });
  parser.write(xml).close();
  return strings;
}

function decodeCell(rawValue, type, sharedStrings) {
  if (rawValue === '') return null;
  if (type === 's') return sharedStrings[Number(rawValue)] ?? '';
  if (type === 'b') return rawValue === '1';
  if (type === 'inlineStr' || type === 'str' || type === 'e') return rawValue;
  const number = Number(rawValue);
  return Number.isFinite(number) ? number : rawValue;
}

function parseWorksheet(xml, sharedStrings) {
  const rows = new Map();
  let currentRow = null;
  let currentCell = null;
  let captureValue = false;
  let rawValue = '';
  const parser = new SaxesParser({ xmlns: false });

  parser.on('opentag', (node) => {
    const name = localName(node.name);
    if (name === 'row') currentRow = Number(attribute(node, 'r') || 0);
    if (name === 'c') {
      currentCell = { column: columnNumber(attribute(node, 'r')), type: attribute(node, 't') || '' };
      rawValue = '';
    }
    if (currentCell && (name === 'v' || (currentCell.type === 'inlineStr' && name === 't'))) captureValue = true;
  });
  parser.on('text', (text) => { if (captureValue) rawValue += text; });
  parser.on('closetag', (tag) => {
    const name = localName(tag.name);
    if (name === 'v' || name === 't') captureValue = false;
    if (name === 'c' && currentCell && currentRow) {
      if (!rows.has(currentRow)) rows.set(currentRow, new Map());
      rows.get(currentRow).set(currentCell.column, decodeCell(rawValue, currentCell.type, sharedStrings));
      currentCell = null;
    }
    if (name === 'row') currentRow = null;
  });
  parser.write(xml).close();
  return rows;
}

function cell(rows, row, column) {
  return rows.get(row)?.get(column) ?? null;
}

function tableRecords(rows, headerRow, firstRow, lastRow, firstColumn, lastColumn) {
  const headers = [];
  for (let column = firstColumn; column <= lastColumn; column += 1) {
    const value = cell(rows, headerRow, column);
    if (value != null && String(value).trim()) headers.push({ column, key: String(value).trim() });
  }
  const records = [];
  for (let row = firstRow; row <= lastRow; row += 1) {
    const record = {};
    let hasValue = false;
    headers.forEach(({ column, key }) => {
      const value = cell(rows, row, column);
      record[key] = value;
      if (value !== null && value !== '') hasValue = true;
    });
    if (hasValue) records.push(record);
  }
  return records;
}

function excelDate(value, includeTime = false) {
  if (!Number.isFinite(Number(value))) return value == null ? null : String(value).slice(0, includeTime ? 19 : 10);
  const milliseconds = Math.round((Number(value) - 25569) * 86400 * 1000);
  const iso = new Date(milliseconds).toISOString();
  return includeTime ? iso.slice(0, 19) : iso.slice(0, 10);
}

function average(values) {
  const numbers = values.map(Number).filter(Number.isFinite);
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
}

function countBy(values, classify = (value) => String(value || '').trim()) {
  return values.reduce((counts, value) => {
    const key = classify(value);
    if (key) counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function createPhase1AnalyticsService(workbookPath) {
  let cache = null;
  let cachedMtime = 0;

  async function getAnalytics() {
    let stat;
    try {
      stat = await fs.stat(workbookPath);
    } catch {
      const error = new Error(`ไม่พบไฟล์วิเคราะห์ที่ ${workbookPath}`);
      error.code = 'ANALYTICS_EXCEL_NOT_FOUND';
      throw error;
    }
    if (cache && stat.mtimeMs === cachedMtime) return cache;

    const directory = await unzipper.Open.file(workbookPath);
    const entries = new Map(directory.files.map((entry) => [entry.path.replace(/\\/g, '/'), entry]));
    async function readEntry(entryPath, required = true) {
      const entry = entries.get(entryPath);
      if (!entry) {
        if (!required) return '';
        const error = new Error(`โครงสร้างไฟล์วิเคราะห์ไม่สมบูรณ์: ไม่พบ ${entryPath}`);
        error.code = 'ANALYTICS_EXCEL_INVALID';
        throw error;
      }
      return (await entry.buffer()).toString('utf8');
    }

    const relationships = parseRelationships(await readEntry('xl/_rels/workbook.xml.rels'));
    const definitions = parseWorkbookSheets(await readEntry('xl/workbook.xml'), relationships);
    const definitionsByName = new Map(definitions.map((definition) => [definition.name, definition]));
    REQUIRED_SHEETS.forEach((name) => {
      if (!definitionsByName.has(name)) {
        const error = new Error(`ไม่พบชีตวิเคราะห์ ${name}`);
        error.code = 'ANALYTICS_EXCEL_INVALID';
        throw error;
      }
    });
    const sharedXml = await readEntry('xl/sharedStrings.xml', false);
    const sharedStrings = sharedXml ? parseSharedStrings(sharedXml) : [];
    const sheets = new Map();
    for (const name of REQUIRED_SHEETS) {
      sheets.set(name, parseWorksheet(await readEntry(definitionsByName.get(name).entryPath), sharedStrings));
    }

    const configRows = sheets.get('Config');
    const config = {};
    for (let row = 2; row <= 8; row += 1) {
      const key = cell(configRows, row, 1);
      if (key) config[String(key)] = cell(configRows, row, 2);
    }

    const integrityRows = sheets.get('5_Integrity');
    const checks = tableRecords(integrityRows, 4, 5, 32, 1, 8);
    const countByTable = {};
    checks.filter((item) => item.check_type === 'COUNT').forEach((item) => {
      countByTable[item.table_name] = Number(item.actual);
    });

    const forecastRows = sheets.get('3_Forecasting');
    const history = [];
    const historySeries = ['CITY', 'RT01', 'RT02', 'RT03', 'RT04'];
    for (let row = 6; row <= 16; row += 1) {
      const month = excelDate(cell(forecastRows, row, 1));
      historySeries.forEach((seriesId, index) => {
        history.push({ series_id: seriesId, month, value: Number(cell(forecastRows, row, index + 3)) });
      });
    }
    const accuracy = tableRecords(forecastRows, 54, 55, 64, 1, 9);
    const forecasts = tableRecords(forecastRows, 68, 69, 98, 1, 10).map((item) => ({
      ...item,
      forecast_month: excelDate(item.forecast_month),
    }));
    const models = tableRecords(forecastRows, 102, 103, 107, 1, 10);

    const dimensionRows = sheets.get('dimensions');
    const series = tableRecords(dimensionRows, 1, 2, 6, 5, 7);
    const modelDefinitions = tableRecords(dimensionRows, 1, 2, 3, 9, 12);

    const optimizationRows = sheets.get('4_Optimization');
    const sensitivity = tableRecords(optimizationRows, 20, 21, 45, 1, 7);
    const goalSeek = tableRecords(optimizationRows, 48, 49, 51, 1, 12).map((item) => ({
      ...item,
      run_at: excelDate(item.run_at, true),
    }));

    const totalChecks = checks.length;
    const passedChecks = checks.filter((item) => item.status === 'PASS').length;
    const submissionRows = sheets.get('user_submissions');
    const lastSubmissionRow = Math.max(...submissionRows.keys());
    const submissions = tableRecords(submissionRows, 1, 2, lastSubmissionRow, 1, 21)
      .filter((item) => {
        const timestamp = item.Timestamp;
        const validTimestamp = Number.isFinite(Number(timestamp)) || /^\d{4}-\d{2}-\d{2}/.test(String(timestamp || ''));
        return item.Submission_ID && validTimestamp && item.Proposed_Price !== null
          && item.Proposed_Price !== '' && Number.isFinite(Number(item.Proposed_Price));
      })
      .map((item) => ({
        submission_id: String(item.Submission_ID),
        timestamp: excelDate(item.Timestamp, true),
        neighbourhood: item.Neighbourhood == null ? null : String(item.Neighbourhood),
        room_type: item.Room_Type == null ? null : String(item.Room_Type),
        market_mean_price: Number(item.Market_Mean_Price),
        market_median_price: Number(item.Market_Median_Price),
        market_est_occupancy: Number(item.Market_Est_Occupancy),
        price_percentile: Number(item.Price_Percentile),
        z_score: Number(item.Z_Score),
        price_status: item.Price_Status == null ? null : String(item.Price_Status),
        break_even_nights: Number(item.BreakEven_Nights),
        break_even_occupancy: Number(item.BreakEven_Occupancy),
        goal_seek_target_price: Number(item.GoalSeek_Target_Price),
        feasibility_verdict: item.Feasibility_Verdict == null ? null : String(item.Feasibility_Verdict),
      }));
    const feasible = submissions.filter((item) => item.feasibility_verdict?.startsWith('FEASIBLE')).length;
    const priceStatus = countBy(submissions.map((item) => item.price_status), (value) => {
      const status = String(value || '').toUpperCase();
      if (status.startsWith('NORMAL')) return 'NORMAL';
      if (status.startsWith('WARNING')) return 'WARNING';
      if (status.startsWith('ANOMALY')) return 'ANOMALY';
      return status || null;
    });
    const feasibility = {
      FEASIBLE: feasible,
      RISKY: submissions.length - feasible,
    };
    cache = {
      source: {
        file: path.basename(workbookPath),
        snapshot_date: excelDate(config.SnapshotDate),
        source_name: config.Source || null,
        saved_at: stat.mtime.toISOString(),
        note: 'Dashboard แสดงค่าผลลัพธ์ที่บันทึกไว้ใน Workbook และไม่ได้สั่งคำนวณหรือแก้ไขไฟล์',
      },
      totals: {
        listings: countByTable.tblListings ?? null,
        neighbourhoods: countByTable.tblNeighbourhoods ?? null,
        lookup_rows: countByTable.tblLookup ?? null,
        calendar_monthly_rows: countByTable.tblCalendarMonthly ?? null,
        submissions: countByTable.tblSubmissions ?? null,
      },
      integrity: {
        overall: cell(integrityRows, 2, 2),
        passed: passedChecks,
        total: totalChecks,
        checks,
      },
      forecasting: {
        description: cell(forecastRows, 2, 1),
        holdout_note: cell(forecastRows, 19, 1),
        series,
        model_definitions: modelDefinitions,
        history,
        accuracy,
        forecasts,
        regression_models: models,
      },
      optimization: {
        selection: {
          lookup_id: cell(optimizationRows, 4, 5),
          neighbourhood: cell(optimizationRows, 5, 5),
          room_type: cell(optimizationRows, 6, 5),
          market_median_price: Number(cell(optimizationRows, 7, 5)),
          market_est_occupancy: Number(cell(optimizationRows, 8, 5)),
        },
        inputs: {
          fixed_cost: Number(cell(optimizationRows, 4, 2)),
          variable_cost: Number(cell(optimizationRows, 5, 2)),
          proposed_price: Number(cell(optimizationRows, 6, 2)),
          target_profit: Number(cell(optimizationRows, 7, 2)),
          expected_occupancy: Number(cell(optimizationRows, 8, 2)),
        },
        results: {
          contribution_per_night: Number(cell(optimizationRows, 11, 2)),
          contribution_margin: Number(cell(optimizationRows, 12, 2)),
          break_even_nights: Number(cell(optimizationRows, 13, 2)),
          break_even_occupancy: Number(cell(optimizationRows, 14, 2)),
          expected_net_profit: Number(cell(optimizationRows, 15, 2)),
          required_price: Number(cell(optimizationRows, 16, 2)),
          price_vs_market_median: Number(cell(optimizationRows, 17, 2)),
        },
        sensitivity,
        goal_seek: goalSeek,
      },
      submissions_analysis: {
        summary: {
          total: submissions.length,
          average_target_price: average(submissions.map((item) => item.goal_seek_target_price)),
          average_break_even_occupancy: average(submissions.map((item) => item.break_even_occupancy)),
          average_market_occupancy: average(submissions.map((item) => item.market_est_occupancy)),
          feasible_rate: submissions.length ? feasible / submissions.length : null,
        },
        price_status: priceStatus,
        feasibility,
        recent: [...submissions]
          .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
          .slice(0, 10),
      },
    };
    cachedMtime = stat.mtimeMs;
    return cache;
  }

  return { getAnalytics };
}

module.exports = { createPhase1AnalyticsService, excelDate };
