const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

function createExcelError(message, code, status = 500, deliveryStatus = 'not_written') {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.deliveryStatus = deliveryStatus;
  return error;
}

function stablePayloadHash(payload) {
  const keys = Object.keys(payload.data).sort();
  const data = Object.fromEntries(keys.map((key) => [key, payload.data[key]]));
  return crypto.createHash('sha256')
    .update(JSON.stringify({ sheet_name: payload.metadata.sheet_name, data }))
    .digest('hex');
}

async function readLedger(ledgerPath) {
  try {
    return JSON.parse(await fs.readFile(ledgerPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, requests: {} };
    throw error;
  }
}

async function writeLedger(ledgerPath, ledger) {
  await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
  const temporaryPath = `${ledgerPath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryPath, ledgerPath);
}

function createPowerShellWriter({ scriptPath, timeoutMs = 30000 }) {
  return function write({ workbookPath, sheetName, data }) {
    return new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', scriptPath,
        '-WorkbookPath', workbookPath,
        '-SheetName', sheetName,
      ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);

      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(createExcelError(`เปิด Excel Writer ไม่สำเร็จ: ${error.message}`, 'EXCEL_WRITER_UNAVAILABLE', 503));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) {
          reject(createExcelError(
            'หมดเวลารอ Excel สถานะการบันทึกไม่แน่นอน ระบบจึงไม่ลองเขียนซ้ำอัตโนมัติ',
            'EXCEL_WRITE_TIMEOUT', 504, 'unknown_after_timeout'
          ));
          return;
        }
        let result;
        try { result = JSON.parse(stdout.trim()); } catch { result = null; }
        if (code !== 0 || !result?.ok) {
          const detail = result?.message || stderr.trim() || 'Excel ไม่สามารถบันทึกข้อมูลได้';
          const locked = /read.?only|lock|ใช้งานอยู่/i.test(detail);
          const duplicateSubmission = /duplicate submission_id/i.test(detail);
          reject(createExcelError(
            locked ? 'ไฟล์ Excel กำลังเปิดหรือถูกล็อกอยู่ กรุณาปิดไฟล์แล้วส่งรายการเดิมอีกครั้ง'
              : duplicateSubmission ? 'Submission_ID นี้มีอยู่แล้ว กรุณาใช้รหัสใหม่' : detail,
            locked ? 'EXCEL_FILE_LOCKED' : duplicateSubmission ? 'SUBMISSION_ID_DUPLICATE' : 'EXCEL_WRITE_FAILED',
            locked ? 423 : duplicateSubmission ? 409 : 500
          ));
          return;
        }
        resolve(result);
      });
      child.stdin.end(JSON.stringify(data));
    });
  };
}

function createLocalExcelService(config, dependencies = {}) {
  const ledgerPath = config.ledgerPath;
  const writer = dependencies.writer || createPowerShellWriter({
    scriptPath: config.writerScriptPath,
    timeoutMs: config.timeoutMs,
  });
  let queue = Promise.resolve();

  async function sendInternal(payload) {
    const requestId = payload.metadata.request_id;
    const hash = stablePayloadHash(payload);
    const ledger = await readLedger(ledgerPath);
    const existing = ledger.requests[requestId];

    if (existing && existing.hash !== hash) {
      throw createExcelError('request_id นี้เคยใช้กับข้อมูลคนละชุด', 'REQUEST_ID_CONFLICT', 409);
    }
    if (existing?.status === 'confirmed') {
      return {
        duplicate: true,
        delivery_status: 'local_excel_saved',
        excel_write_status: 'confirmed',
        request_id: requestId,
        excel_reference: existing.excel_reference,
        calculated_values: existing.calculated_values || null,
        message: 'รายการนี้บันทึกใน Excel แล้ว ระบบจึงไม่เพิ่มแถวซ้ำ',
      };
    }
    if (existing?.status === 'unknown') {
      throw createExcelError(
        'สถานะการบันทึกรายการนี้ยังไม่แน่นอน กรุณาตรวจ Excel ก่อนส่งซ้ำ',
        'EXCEL_WRITE_STATUS_UNKNOWN', 409, 'unknown_after_timeout'
      );
    }

    ledger.requests[requestId] = {
      hash,
      sheet_name: payload.metadata.sheet_name,
      status: 'pending',
      submitted_at: payload.metadata.submitted_at,
      updated_at: new Date().toISOString(),
    };
    await writeLedger(ledgerPath, ledger);

    try {
      const result = await writer({
        workbookPath: config.workbookPath,
        sheetName: payload.metadata.sheet_name,
        data: payload.data,
      });
      ledger.requests[requestId] = {
        ...ledger.requests[requestId],
        status: 'confirmed',
        updated_at: new Date().toISOString(),
        excel_reference: `${payload.metadata.sheet_name}!${result.table_name}[row ${result.row_number}]`,
        calculated_values: result.calculated_values || null,
      };
      await writeLedger(ledgerPath, ledger);
      return {
        duplicate: false,
        delivery_status: 'local_excel_saved',
        excel_write_status: 'confirmed',
        request_id: requestId,
        excel_reference: ledger.requests[requestId].excel_reference,
        calculated_values: result.calculated_values || null,
        message: `บันทึกลง Excel และคำนวณผลลัพธ์แล้ว (${payload.metadata.sheet_name})`,
      };
    } catch (error) {
      ledger.requests[requestId] = {
        ...ledger.requests[requestId],
        status: error.deliveryStatus === 'unknown_after_timeout' ? 'unknown' : 'failed',
        updated_at: new Date().toISOString(),
        error_code: error.code || 'EXCEL_WRITE_FAILED',
      };
      await writeLedger(ledgerPath, ledger);
      throw error;
    }
  }

  function send(payload) {
    const operation = queue.then(() => sendInternal(payload));
    queue = operation.catch(() => undefined);
    return operation;
  }

  return { send };
}

module.exports = { createLocalExcelService, createPowerShellWriter, stablePayloadHash };
