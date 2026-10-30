const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLocalExcelService } = require('../services/localExcelService');

const payload = {
  metadata: {
    sheet_name: 'user_submissions',
    request_id: '2b5cbb42-85e1-4f9e-b71b-9ae8ef9e1ed4',
    submitted_at: '2026-10-27T10:00:00.000Z',
  },
  data: { Submission_ID: 'SUB-TEST-001', Timestamp: '2026-10-28T14:30', Target_Occupancy: 0.5 },
};

async function withService(writer, callback) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'stayhub-ledger-'));
  const service = createLocalExcelService({
    workbookPath: 'example.xlsx',
    ledgerPath: path.join(directory, 'ledger.json'),
  }, { writer });
  try { await callback(service); } finally { await fs.rm(directory, { recursive: true, force: true }); }
}

test('บันทึกสำเร็จและรายงานตำแหน่ง Excel', async () => {
  await withService(async ({ sheetName, data }) => {
    assert.equal(sheetName, 'user_submissions');
    assert.equal(data.Submission_ID, 'SUB-TEST-001');
    return { ok: true, table_name: 'tblSubmissions', row_number: 7, calculated_values: { Price_Status: 'NORMAL' } };
  }, async (service) => {
    const result = await service.send(payload);
    assert.equal(result.excel_write_status, 'confirmed');
    assert.equal(result.excel_reference, 'user_submissions!tblSubmissions[row 7]');
    assert.equal(result.calculated_values.Price_Status, 'NORMAL');
  });
});

test('request_id เดิมและข้อมูลเดิมไม่เพิ่มแถวซ้ำ', async () => {
  let writes = 0;
  await withService(async () => {
    writes += 1;
    return { ok: true, table_name: 'tblSubmissions', row_number: 7 };
  }, async (service) => {
    await service.send(payload);
    const duplicate = await service.send(payload);
    assert.equal(writes, 1);
    assert.equal(duplicate.duplicate, true);
  });
});

test('request_id เดิมแต่ข้อมูลเปลี่ยนถูกปฏิเสธ', async () => {
  await withService(async () => ({ ok: true, table_name: 'tblSubmissions', row_number: 7 }), async (service) => {
    await service.send(payload);
    await assert.rejects(service.send({
      ...payload,
      data: { ...payload.data, Target_Occupancy: 0.6 },
    }), (error) => error.code === 'REQUEST_ID_CONFLICT');
  });
});

test('เขียนไม่สำเร็จยังใช้ request_id เดิมลองใหม่ได้', async () => {
  let attempts = 0;
  await withService(async () => {
    attempts += 1;
    if (attempts === 1) throw Object.assign(new Error('locked'), { code: 'EXCEL_FILE_LOCKED', deliveryStatus: 'not_written' });
    return { ok: true, table_name: 'tblSubmissions', row_number: 7 };
  }, async (service) => {
    await assert.rejects(service.send(payload));
    const result = await service.send(payload);
    assert.equal(result.excel_write_status, 'confirmed');
    assert.equal(attempts, 2);
  });
});

test('สถานะ timeout ไม่เขียนซ้ำอัตโนมัติ', async () => {
  let attempts = 0;
  await withService(async () => {
    attempts += 1;
    throw Object.assign(new Error('timeout'), { code: 'EXCEL_WRITE_TIMEOUT', deliveryStatus: 'unknown_after_timeout' });
  }, async (service) => {
    await assert.rejects(service.send(payload));
    await assert.rejects(service.send(payload), (error) => error.code === 'EXCEL_WRITE_STATUS_UNKNOWN');
    assert.equal(attempts, 1);
  });
});
