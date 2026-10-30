const express = require('express');
const { validateSubmission } = require('../validators/submissionValidator');
const { asyncRoute } = require('./asyncRoute');

function createSubmissionRouter({ schemaService, submissionService, readOnly = false }) {
  const router = express.Router();
  router.post('/', asyncRoute(async (request, response) => {
    if (readOnly) {
      const error = new Error('ระบบอยู่ในโหมดอ่านอย่างเดียวและจะไม่แก้ไข StayHub_final.xlsx');
      error.status = 403;
      error.code = 'READ_ONLY_MODE';
      throw error;
    }
    const schema = await schemaService.getSchema();
    const validation = validateSubmission(request.body, schema);
    if (!validation.valid) {
      const error = new Error('กรุณาตรวจสอบข้อมูลที่กรอก');
      error.status = 422;
      error.code = 'VALIDATION_ERROR';
      error.fields = validation.errors;
      throw error;
    }

    const payload = {
      metadata: {
        sheet_name: validation.value.sheetName,
        request_id: validation.value.requestId,
        submitted_at: new Date().toISOString(),
      },
      data: validation.value.data,
    };
    const result = await submissionService.send(payload);
    response.status(200).json({ ok: true, ...result });
  }));
  return router;
}

module.exports = { createSubmissionRouter };
