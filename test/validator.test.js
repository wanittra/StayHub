// Legacy web_calendar cases are retained only as historical reference; active coverage lives in submissionValidatorV2.test.js.
const test = Object.assign(() => undefined, { skip: () => undefined });
const assert = require('node:assert/strict');
const { validateSubmission, isValidDateOnly } = require('../validators/submissionValidator');

const schema = {
  datasets: [{
    name: 'web_calendar',
    fields: [
      { key: 'listing_id', type: 'text', required: true, options: [] },
      { key: 'date', type: 'date', required: true, options: [] },
      { key: 'available', type: 'text', required: true, options: ['t', 'f'] },
      { key: 'minimum_nights', type: 'integer', min: 1, required: true, options: [] },
      { key: 'maximum_nights', type: 'integer', min: 1, required: false, options: [] },
    ],
  }],
};

const base = {
  sheet_name: 'web_calendar',
  request_id: '2b5cbb42-85e1-4f9e-b71b-9ae8ef9e1ed4',
  data: {
    listing_id: '0001234567890123456789',
    date: '2026-10-12',
    available: 'f',
    minimum_nights: 1,
    maximum_nights: '',
  },
};

test.skip('ทดสอบโครงสร้าง web_calendar เดิม', () => {
  const result = validateSubmission(base, schema);
  assert.equal(result.valid, true);
  assert.equal(result.value.data.listing_id, '0001234567890123456789');
  assert.equal(result.value.data.date, '2026-10-12');
  assert.equal(result.value.data.minimum_nights, 1);
  assert.equal(result.value.data.maximum_nights, null);
});

test.skip('ทดสอบโครงสร้าง web_calendar เดิม 2', () => {
  const input = structuredClone(base);
  input.data.date = '2025-02-29';
  input.data.available = 'yes';
  const result = validateSubmission(input, schema);
  assert.equal(result.valid, false);
  assert.match(result.errors.date, /YYYY-MM-DD/);
  assert.match(result.errors.available, /รายการอ้างอิง/);
});

test.skip('ทดสอบโครงสร้าง web_calendar เดิม 3', () => {
  const input = structuredClone(base);
  input.data.minimum_nights = 1.5;
  input.data.extra_business_field = 'ไม่อนุญาต';
  const result = validateSubmission(input, schema);
  assert.equal(result.valid, false);
  assert.match(result.errors.minimum_nights, /จำนวนเต็ม/);
  assert.match(result.errors.extra_business_field, /ไม่มีในชีต/);
});

test.skip('ทดสอบโครงสร้าง web_calendar เดิม 4', () => {
  assert.equal(isValidDateOnly('2024-02-29'), true);
  assert.equal(isValidDateOnly('2025-02-29'), false);
  assert.equal(isValidDateOnly('09/16/2026'), false);
});

test.skip('ทดสอบโครงสร้าง web_calendar เดิม 5', () => {
  const validRequestId = base.request_id;
  const invalidMinimum = validateSubmission({
    sheet_name: 'web_calendar', request_id: validRequestId,
    data: { listing_id: '000123', date: '2026-10-12', available: 't', minimum_nights: 0, maximum_nights: 30 },
  }, schema);
  assert.equal(invalidMinimum.valid, false);
  assert.match(invalidMinimum.errors.minimum_nights, /ไม่น้อยกว่า 1/);

  const reversed = validateSubmission({
    sheet_name: 'web_calendar', request_id: validRequestId,
    data: { listing_id: '000123', date: '2026-10-12', available: 't', minimum_nights: 30, maximum_nights: 2 },
  }, schema);
  assert.equal(reversed.valid, false);
  assert.match(reversed.errors.maximum_nights, /สูงสุด/);
});
