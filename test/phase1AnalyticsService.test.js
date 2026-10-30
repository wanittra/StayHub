const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createPhase1AnalyticsService } = require('../services/phase1AnalyticsService');

test('อ่านผลวิเคราะห์จาก fixture โดยไม่เปลี่ยน Workbook', async () => {
  const service = createPhase1AnalyticsService(path.resolve(__dirname, 'StayHub_final_write_test.xlsx'));
  const result = await service.getAnalytics();
  assert.equal(result.source.file, 'StayHub_final_write_test.xlsx');
  assert.equal(result.totals.listings, 30922);
  assert.equal(result.integrity.overall, 'ALL CHECKS PASS');
  assert.equal(result.integrity.passed, 28);
  assert.equal(result.forecasting.history.length, 55);
  assert.equal(result.forecasting.accuracy.length, 10);
  assert.equal(result.forecasting.forecasts.length, 30);
  assert.equal(result.optimization.sensitivity.length, 25);
  assert.equal(result.optimization.goal_seek.length, 3);
  assert.equal(result.optimization.results.break_even_occupancy > 0, true);
  assert.equal(result.submissions_analysis.summary.total, 5);
  assert.equal(result.submissions_analysis.recent.length, 5);
  assert.equal(result.submissions_analysis.summary.average_target_price > 0, true);
});
