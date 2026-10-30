const express = require('express');
const { asyncRoute } = require('./asyncRoute');

function createReviewsRouter({ reviewService, catalogService }) {
  const router = express.Router();

  router.get('/', asyncRoute(async (request, response) => {
    const listingId = String(request.query.listing_id || '').trim();
    if (!listingId) return response.status(400).json({ ok: false, code: 'LISTING_ID_REQUIRED', message: 'กรุณาระบุ listing_id' });
    const reviews = await reviewService.list(listingId);
    return response.json({ ok: true, reviews, total: reviews.length });
  }));

  router.post('/', asyncRoute(async (request, response) => {
    const listingId = String(request.body?.listing_id || '').trim();
    const listing = listingId ? await catalogService.getListing(listingId) : null;
    if (!listing) return response.status(404).json({ ok: false, code: 'LISTING_NOT_FOUND', message: 'ไม่พบข้อมูลที่พักสำหรับรีวิว' });
    const result = await reviewService.create(request.body || {});
    return response.status(result.duplicate ? 200 : 201).json({
      ok: true,
      ...result,
      storage: 'local_json',
      message: result.duplicate ? 'รีวิวนี้ถูกบันทึกไว้แล้ว' : 'บันทึกรีวิวแล้ว',
    });
  }));

  return router;
}

module.exports = { createReviewsRouter };
