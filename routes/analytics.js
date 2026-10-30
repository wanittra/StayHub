const express = require('express');
const { asyncRoute } = require('./asyncRoute');

function createAnalyticsRouter(analyticsService) {
  const router = express.Router();
  router.get('/', asyncRoute(async (request, response) => {
    try {
      response.json({ ok: true, ...(await analyticsService.getAnalytics()) });
    } catch (error) {
      if (['ANALYTICS_EXCEL_NOT_FOUND', 'ANALYTICS_EXCEL_INVALID'].includes(error.code)) error.status = 503;
      throw error;
    }
  }));
  return router;
}

module.exports = { createAnalyticsRouter };
