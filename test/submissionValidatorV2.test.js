const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSubmission, isValidLocalDateTime } = require('../validators/submissionValidator');

const schema = {
  datasets: [{
    name: 'user_submissions',
    validPairs: [{ neighbourhood: 'Bang Rak', room_type: 'Private room' }],
    fields: [
      { key: 'Submission_ID', type: 'text', required: true, options: [] },
      { key: 'Timestamp', type: 'datetime', required: true, options: [] },
      { key: 'Neighbourhood', type: 'text', required: true, options: ['Bang Rak'] },
      { key: 'Room_Type', type: 'text', required: true, options: ['Private room', 'Entire home/apt'] },
      { key: 'Proposed_Price', type: 'number', min: 0.01, required: true, options: [] },
      { key: 'Monthly_FC', type: 'number', min: 0, required: true, options: [] },
      { key: 'PerNight_VC', type: 'number', min: 0, required: true, options: [] },
      { key: 'Target_Profit', type: 'number', min: 0, required: true, options: [] },
      { key: 'Target_Occupancy', type: 'percentage', min: 0.01, max: 1, required: true, options: [] },
    ],
  }],
};

const base = {
  sheet_name: 'user_submissions',
  request_id: '2b5cbb42-85e1-4f9e-b71b-9ae8ef9e1ed4',
  data: {
    Submission_ID: 'SUB-TEST-001', Timestamp: '2026-10-28T14:30',
    Neighbourhood: 'Bang Rak', Room_Type: 'Private room', Proposed_Price: 1500,
    Monthly_FC: 0, PerNight_VC: 250, Target_Profit: 10000, Target_Occupancy: 0.5,
  },
};

test('รักษา Submission_ID เป็นข้อความและแยกเลข 0 จากค่าว่าง', () => {
  const result = validateSubmission(base, schema);
  assert.equal(result.valid, true);
  assert.equal(result.value.data.Submission_ID, 'SUB-TEST-001');
  assert.equal(result.value.data.Monthly_FC, 0);
  assert.equal(result.value.data.Target_Occupancy, 0.5);
});

test('ปฏิเสธ timestamp และอัตราเข้าพักที่ไม่ถูกต้อง', () => {
  const input = structuredClone(base);
  input.data.Timestamp = '2026-02-30T25:00';
  input.data.Target_Occupancy = 1.5;
  const result = validateSubmission(input, schema);
  assert.equal(result.valid, false);
  assert.match(result.errors.Timestamp, /วันและเวลา/);
  assert.match(result.errors.Target_Occupancy, /ไม่เกิน/);
});

test('ปฏิเสธคอลัมน์นอก Excel และคู่เขตกับประเภทห้องที่ไม่มีใน lookup', () => {
  const input = structuredClone(base);
  input.data.Room_Type = 'Entire home/apt';
  input.data.extra = 'not allowed';
  const result = validateSubmission(input, schema);
  assert.equal(result.valid, false);
  assert.match(result.errors.extra, /ไม่มีในชีต/);
  assert.match(result.errors.Room_Type, /tblLookup/);
});

test('ตรวจ datetime-local โดยไม่แปลง timezone', () => {
  assert.equal(isValidLocalDateTime('2026-10-28T09:05'), true);
  assert.equal(isValidLocalDateTime('2026-10-28T24:00'), false);
});
