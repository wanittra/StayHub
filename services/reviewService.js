const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const GUEST_ACCOUNT = Object.freeze({
  id: 'guest_demo',
  name: 'มะลิ สุขใจ',
  role: 'guest',
});

function reviewError(message, code, status = 400, fields) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.fields = fields;
  return error;
}

async function readStore(filePath) {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return { version: 1, reviews: Array.isArray(parsed.reviews) ? parsed.reviews : [] };
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, reviews: [] };
    throw reviewError('อ่านข้อมูลรีวิวของเว็บไซต์ไม่สำเร็จ', 'REVIEW_STORE_INVALID', 500);
  }
}

async function writeStore(filePath, store) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryPath, filePath);
}

function validateReview(input) {
  const fields = {};
  const listingId = String(input.listing_id || '').trim();
  const requestId = String(input.request_id || '').trim();
  const comment = String(input.comment || '').trim();
  const rating = Number(input.rating);
  if (!listingId) fields.listing_id = 'ไม่พบรหัสที่พัก';
  if (!requestId || requestId.length > 100) fields.request_id = 'request_id ไม่ถูกต้อง';
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) fields.rating = 'กรุณาให้คะแนน 1–5 ดาว';
  if (comment.length < 3) fields.comment = 'กรุณาเขียนรีวิวอย่างน้อย 3 ตัวอักษร';
  if (comment.length > 800) fields.comment = 'รีวิวยาวได้ไม่เกิน 800 ตัวอักษร';
  if (Object.keys(fields).length) throw reviewError('กรุณาตรวจข้อมูลรีวิว', 'REVIEW_VALIDATION_FAILED', 422, fields);
  return { listingId, requestId, rating, comment };
}

function createReviewService({ filePath }) {
  let queue = Promise.resolve();

  async function list(listingId) {
    const store = await readStore(filePath);
    return store.reviews
      .filter((review) => review.listing_id === String(listingId))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async function createInternal(input) {
    const values = validateReview(input);
    const store = await readStore(filePath);
    const duplicate = store.reviews.find((review) => review.request_id === values.requestId);
    if (duplicate) return { review: duplicate, duplicate: true };
    const review = {
      review_id: crypto.randomUUID(),
      request_id: values.requestId,
      listing_id: values.listingId,
      rating: values.rating,
      comment: values.comment,
      reviewer: GUEST_ACCOUNT,
      created_at: new Date().toISOString(),
    };
    store.reviews.push(review);
    await writeStore(filePath, store);
    return { review, duplicate: false };
  }

  function create(input) {
    const operation = queue.then(() => createInternal(input));
    queue = operation.catch(() => undefined);
    return operation;
  }

  return { list, create };
}

module.exports = { createReviewService, validateReview, GUEST_ACCOUNT };
