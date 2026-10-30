const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createCatalogService, parseCsvLine } = require('../services/catalogService');

test('อ่าน CSV ที่มี comma และ quote ในข้อความได้', () => {
  assert.deepEqual(parseCsvLine('1,"Room, with ""view""",Bangkok'), ['1', 'Room, with "view"', 'Bangkok']);
});

test('ค้นหาและกรอง listings โดยรักษา id เป็นข้อความ', async () => {
  const service = createCatalogService(path.resolve(__dirname, '../file'));
  const result = await service.searchListings({ q: '27934', page_size: '6' });
  const exact = result.items.find((item) => item.id === '27934');
  assert.ok(exact);
  assert.equal(typeof exact.id, 'string');
  assert.equal(exact.neighbourhood, 'Ratchathewi');

  const filtered = await service.searchListings({ neighbourhood: 'Ratchathewi', min_reviews: '1', page_size: '6' });
  assert.ok(filtered.pagination.total > 0);
  assert.ok(filtered.items.every((item) => item.neighbourhood === 'Ratchathewi' && item.number_of_reviews >= 1));
});

test('อ่านรายละเอียด listing และไม่พบ id ที่ไม่มีใน master data', async () => {
  const service = createCatalogService(path.resolve(__dirname, '../file'));
  const item = await service.getListing('27934');
  assert.equal(item.name, 'Nice room with superb city view');
  assert.equal(await service.getListing('ไม่มีรหัสนี้'), null);
});

test('ใช้รีวิวและ calendar_monthly เมื่อไม่มี calendar รายวัน', async () => {
  const service = createCatalogService(path.resolve(__dirname, '../file'));
  const activity = await service.getActivity('27934');
  assert.deepEqual(activity.calendar, []);
  assert.match(activity.calendar_note, /ไม่มีปฏิทินรายวัน/);
  assert.ok(Array.isArray(activity.reviews));

  const overview = await service.getOverview();
  assert.ok(overview.calendar_months.length > 0);
  assert.ok(overview.calendar_months.every((row) => Number.isFinite(row.available_ratio)));
});

test('คืน GeoJSON ว่างเมื่อชุดข้อมูลไม่มีไฟล์ขอบเขตเขต', async () => {
  const service = createCatalogService(path.resolve(__dirname, '../file'));
  const geojson = await service.getGeoJson();
  assert.equal(geojson.type, 'FeatureCollection');
  assert.deepEqual(geojson.features, []);
});
