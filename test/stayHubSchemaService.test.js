const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createSchemaService } = require('../services/stayHubSchemaService');

test('อ่านฟอร์ม A–I และผลลัพธ์ K–U จาก StayHub_final โดยไม่แก้ไฟล์', async () => {
  const service = createSchemaService(path.join(__dirname, '..', 'file', 'StayHub_final.xlsx'));
  const schema = await service.getSchema();
  assert.equal(schema.datasets.length, 1);
  assert.equal(schema.datasets[0].name, 'user_submissions');
  assert.deepEqual(schema.datasets[0].fields.map((field) => field.key), [
    'Submission_ID', 'Timestamp', 'Neighbourhood', 'Room_Type', 'Proposed_Price',
    'Monthly_FC', 'PerNight_VC', 'Target_Profit', 'Target_Occupancy',
  ]);
  assert.equal(schema.datasets[0].resultFields.length, 11);
  assert.ok(schema.datasets[0].validPairs.length > 0);
});
