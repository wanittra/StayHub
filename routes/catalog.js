const express = require('express');
const { asyncRoute } = require('./asyncRoute');

function createCatalogRouter(catalogService) {
  const router = express.Router();

  router.get('/listings', asyncRoute(async (request, response) => {
    response.json({ ok: true, ...(await catalogService.searchListings(request.query)) });
  }));

  router.get('/listings/:id', asyncRoute(async (request, response) => {
    const item = await catalogService.getListing(request.params.id);
    if (!item) return response.status(404).json({ ok: false, code: 'LISTING_NOT_FOUND', message: 'ไม่พบข้อมูลที่พัก' });
    return response.json({ ok: true, item });
  }));

  router.get('/listings/:id/activity', asyncRoute(async (request, response) => {
    const activity = await catalogService.getActivity(request.params.id);
    if (!activity) return response.status(404).json({ ok: false, code: 'LISTING_NOT_FOUND', message: 'ไม่พบข้อมูลที่พัก' });
    return response.json({ ok: true, ...activity });
  }));

  router.get('/overview', asyncRoute(async (request, response) => {
    response.json({ ok: true, ...(await catalogService.getOverview()) });
  }));

  router.get('/neighbourhoods.geojson', asyncRoute(async (request, response) => {
    response.type('application/geo+json').send(await catalogService.getGeoJson());
  }));

  return router;
}

module.exports = { createCatalogRouter };
