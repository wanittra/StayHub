require('dotenv').config();

const path = require('node:path');
const express = require('express');
const { createSchemaService } = require('./services/stayHubSchemaService');
const { createLocalExcelService } = require('./services/localExcelService');
const { createCatalogService } = require('./services/catalogService');
const { createPhase1AnalyticsService } = require('./services/phase1AnalyticsService');
const { createReviewService } = require('./services/reviewService');
const { createSchemaRouter } = require('./routes/schema');
const { createSubmissionRouter } = require('./routes/submissions');
const { createCatalogRouter } = require('./routes/catalog');
const { createAnalyticsRouter } = require('./routes/analytics');
const { createReviewsRouter } = require('./routes/reviews');

function parseBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  return String(value).toLowerCase() === 'true';
}

function createApp(options = {}) {
  const config = {
    excelPath: path.resolve(options.excelPath || process.env.EXCEL_SCHEMA_PATH || './file/StayHub_final.xlsx'),
    analyticsPath: path.resolve(options.analyticsPath || process.env.ANALYTICS_WORKBOOK_PATH || './file/StayHub_final.xlsx'),
    timeoutMs: Number(options.timeoutMs || process.env.EXCEL_WRITE_TIMEOUT_MS || 300000),
    ledgerPath: path.resolve(options.ledgerPath || process.env.SUBMISSION_LEDGER_PATH || './data/submission-ledger.json'),
    reviewsPath: path.resolve(options.reviewsPath || process.env.LOCAL_REVIEWS_PATH || './data/local-reviews.json'),
    readOnlyMode: options.readOnlyMode !== undefined
      ? options.readOnlyMode : parseBoolean(process.env.READ_ONLY_MODE, false),
  };

  const schemaService = options.schemaService || (config.readOnlyMode ? {
    getSchema: async () => ({
      sourceFile: path.basename(config.excelPath),
      datasets: [],
      referenceSheets: [],
      readOnly: true,
      message: 'ชุดข้อมูลใหม่ใช้สำหรับแสดงผลและวิเคราะห์ เว็บไซต์จึงไม่เขียนแก้ Workbook นี้',
    }),
  } : createSchemaService(config.excelPath));
  const catalogService = options.catalogService || createCatalogService(path.join(__dirname, 'file'));
  const analyticsService = options.analyticsService || createPhase1AnalyticsService(config.analyticsPath);
  const reviewService = options.reviewService || createReviewService({ filePath: config.reviewsPath });
  const submissionService = options.submissionService || (config.readOnlyMode ? {
    send: async () => {
      const error = new Error('ระบบอยู่ในโหมดอ่านอย่างเดียวและจะไม่แก้ไข StayHub_final.xlsx');
      error.status = 403;
      error.code = 'READ_ONLY_MODE';
      throw error;
    },
  } : createLocalExcelService({
      workbookPath: config.excelPath,
      ledgerPath: config.ledgerPath,
      timeoutMs: config.timeoutMs,
      writerScriptPath: path.join(__dirname, 'scripts', 'write-excel-row.ps1'),
    }));
  const app = express();

  app.disable('x-powered-by');
  app.use((request, response, next) => {
    response.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://images.unsplash.com; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    });
    next();
  });
  app.use(express.json({ limit: '256kb' }));

  app.get('/api/health', (request, response) => {
    response.json({
      ok: true,
      mode: config.readOnlyMode ? 'read_only_excel' : 'local_excel',
      workbook: path.basename(config.excelPath),
      writable: !config.readOnlyMode,
    });
  });
  app.use('/api/schema', createSchemaRouter(schemaService));
  app.use('/api/catalog', createCatalogRouter(catalogService));
  app.use('/api/analytics', createAnalyticsRouter(analyticsService));
  app.use('/api/reviews', createReviewsRouter({ reviewService, catalogService }));
  app.use('/api/submissions', createSubmissionRouter({
    schemaService,
    submissionService,
    readOnly: config.readOnlyMode,
  }));
  app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'deny', index: 'index.html' }));

  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    const status = Number(error.status) || 500;
    const safeMessage = status >= 500 && !error.code ? 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' : error.message;
    response.status(status).json({
      ok: false,
      code: error.code || 'INTERNAL_ERROR',
      message: safeMessage,
      fields: error.fields || undefined,
      delivery_status: error.deliveryStatus || undefined,
    });
  });

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const app = createApp();
  app.listen(port, () => console.log(`เปิดเว็บไซต์ที่ http://localhost:${port}`));
}

module.exports = { createApp };
