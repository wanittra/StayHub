const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createReviewService, validateReview } = require('../services/reviewService');

test('review validator แยกคะแนนและข้อความที่ไม่ถูกต้อง', () => {
  assert.throws(() => validateReview({ listing_id: '1', request_id: 'r1', rating: 0, comment: 'x' }), (error) => {
    assert.equal(error.code, 'REVIEW_VALIDATION_FAILED');
    assert.equal(error.status, 422);
    assert.ok(error.fields.rating);
    assert.ok(error.fields.comment);
    return true;
  });
});

test('review service เก็บรีวิวใน JSON และไม่เพิ่มซ้ำเมื่อ request_id เดิม', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'stayhub-review-'));
  const filePath = path.join(directory, 'reviews.json');
  try {
    const service = createReviewService({ filePath });
    const input = { listing_id: '27934', request_id: 'request-1', rating: 4, comment: 'ทำเลดี เดินทางสะดวก' };
    const first = await service.create(input);
    const second = await service.create(input);
    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    const reviews = await service.list('27934');
    assert.equal(reviews.length, 1);
    assert.equal(reviews[0].reviewer.role, 'guest');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
