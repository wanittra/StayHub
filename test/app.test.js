const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');

const schema = {
  sourceFile: 'StayHub.xlsx',
  datasets: [{
    name: 'user_submissions', rowCount: 0,
    fields: [
      { key: 'Submission_ID', type: 'text', required: true, options: [] },
      { key: 'Timestamp', type: 'datetime', required: true, options: [] },
    ],
  }],
  referenceSheets: [],
};

async function withServer(callback) {
  const captured = [];
  const localReviews = [];
  const app = createApp({
    schemaService: { getSchema: async () => schema },
    catalogService: {
      searchListings: async () => ({ items: [{ id: '27934', name: 'ตัวอย่าง' }], map_items: [], pagination: { page: 1, pages: 1, total: 1 }, filters: {} }),
      getListing: async (id) => (id === '27934' ? { id, name: 'ตัวอย่าง' } : null),
      getActivity: async () => ({ reviews: [] }),
      getOverview: async () => ({ totals: { listings: 1 } }),
      getGeoJson: async () => ({ type: 'FeatureCollection', features: [] }),
    },
    analyticsService: {
      getAnalytics: async () => ({
        source: { file: 'StayHub_final.xlsx' },
        totals: { listings: 30922 },
        integrity: { overall: 'ALL CHECKS PASS', passed: 28, total: 28, checks: [] },
        forecasting: { history: [], accuracy: [], forecasts: [], series: [] },
        optimization: { sensitivity: [], goal_seek: [] },
      }),
    },
    submissionService: { send: async (payload) => {
      captured.push(payload);
      return { delivery_status: 'local_excel_saved', excel_write_status: 'confirmed', calculated_values: { Price_Status: 'NORMAL' } };
    } },
    reviewService: {
      list: async (listingId) => localReviews.filter((review) => review.listing_id === listingId),
      create: async (input) => {
        const review = { review_id: 'review-1', request_id: input.request_id, listing_id: input.listing_id, rating: input.rating, comment: input.comment, reviewer: { id: 'guest_demo', name: 'มะลิ สุขใจ', role: 'guest' }, created_at: '2026-10-28T12:00:00.000Z' };
        localReviews.push(review);
        return { review, duplicate: false };
      },
    },
    readOnlyMode: false,
  });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const address = server.address();
    await callback(`http://127.0.0.1:${address.port}`, captured);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('schema API ส่งเฉพาะ schema และ static server ไม่เปิดโฟลเดอร์ file', async () => {
  await withServer(async (baseUrl) => {
    const schemaResponse = await fetch(`${baseUrl}/api/schema`);
    assert.equal(schemaResponse.status, 200);
    const body = await schemaResponse.json();
    assert.equal(body.datasets[0].name, 'user_submissions');
    const fileResponse = await fetch(`${baseUrl}/file/StayHub.xlsx`);
    assert.equal(fileResponse.status, 404);
  });
});

test('submission API ส่งชีต user_submissions และคืนผลคำนวณ', async () => {
  await withServer(async (baseUrl, captured) => {
    const response = await fetch(`${baseUrl}/api/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sheet_name: 'user_submissions',
        request_id: '2b5cbb42-85e1-4f9e-b71b-9ae8ef9e1ed4',
        data: { Submission_ID: 'SUB-TEST-001', Timestamp: '2026-10-28T14:30' },
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(captured.length, 1);
    assert.equal(captured[0].metadata.sheet_name, 'user_submissions');
    assert.equal(captured[0].metadata.request_id, '2b5cbb42-85e1-4f9e-b71b-9ae8ef9e1ed4');
    assert.deepEqual(captured[0].data, { Submission_ID: 'SUB-TEST-001', Timestamp: '2026-10-28T14:30' });
  });
});

test('health API แจ้งว่าใช้ Excel ในเครื่อง', async () => {
  const app = createApp({
    readOnlyMode: true,
    catalogService: {
      searchListings: async () => ({ items: [], map_items: [], pagination: {}, filters: {} }),
      getListing: async () => null,
      getActivity: async () => null,
      getOverview: async () => ({}),
      getGeoJson: async () => ({ type: 'FeatureCollection', features: [] }),
    },
    analyticsService: { getAnalytics: async () => ({}) },
  });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const response = await fetch(`${baseUrl}/api/health`);
    const body = await response.json();
    assert.equal(body.mode, 'read_only_excel');
    assert.equal(body.workbook, 'StayHub_final.xlsx');
    assert.equal(body.writable, false);
    const submission = await fetch(`${baseUrl}/api/submissions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(submission.status, 403);
    assert.equal((await submission.json()).code, 'READ_ONLY_MODE');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('catalog API ส่งข้อมูลสำรวจโดยไม่เปิดไฟล์ CSV โดยตรง', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/catalog/listings`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.items[0].id, '27934');
    assert.equal((await fetch(`${baseUrl}/file/listings.csv`)).status, 404);
  });
});

test('analytics API ส่งผลจาก service โดยไม่เปิดไฟล์ Excel โดยตรง', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/analytics`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.source.file, 'StayHub_final.xlsx');
    assert.equal(body.integrity.passed, 28);
    assert.equal((await fetch(`${baseUrl}/file/StayHub_final.xlsx`)).status, 404);
  });
});

test('บัญชีผู้เข้าพักเพิ่มและอ่านรีวิวผ่าน API แยกจาก Excel', async () => {
  await withServer(async (baseUrl) => {
    const created = await fetch(`${baseUrl}/api/reviews`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listing_id: '27934', request_id: 'review-request-1', rating: 5, comment: 'เดินทางสะดวกและห้องสะอาด' }),
    });
    assert.equal(created.status, 201);
    const createdBody = await created.json();
    assert.equal(createdBody.storage, 'local_json');
    assert.equal(createdBody.review.rating, 5);
    const listed = await fetch(`${baseUrl}/api/reviews?listing_id=27934`);
    const listedBody = await listed.json();
    assert.equal(listedBody.total, 1);
    assert.equal(listedBody.reviews[0].listing_id, '27934');
  });
});
