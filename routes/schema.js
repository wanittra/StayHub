const express = require('express');
const { asyncRoute } = require('./asyncRoute');

function createSchemaRouter(schemaService) {
  const router = express.Router();
  router.get('/', asyncRoute(async (request, response) => {
    try {
      const schema = await schemaService.getSchema();
      response.json({ ok: true, ...schema });
    } catch (error) {
      error.status = error.code === 'EXCEL_NOT_FOUND' ? 503 : 500;
      throw error;
    }
  }));
  return router;
}

module.exports = { createSchemaRouter };
