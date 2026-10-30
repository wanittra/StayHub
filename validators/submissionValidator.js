function isBlank(value) {
  return value === '' || value === null || value === undefined;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getLookupOptions(field, schema) {
  if (field.lookup && Array.isArray(schema.lookups?.[field.lookup])) return schema.lookups[field.lookup];
  return Array.isArray(field.lookupOptions) ? field.lookupOptions : [];
}

function isValidDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isValidLocalDateTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return false;
  const [datePart, timePart] = value.split('T');
  if (!isValidDateOnly(datePart)) return false;
  const [hour, minute, second = '0'] = timePart.split(':').map(Number);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59;
}

function normaliseField(field, value) {
  if (isBlank(value)) return { value: null };
  if (['text', 'textarea'].includes(field.type)) {
    if (typeof value !== 'string') return { error: 'ต้องเป็นข้อความ' };
    if (value.length > 5000) return { error: 'ข้อความยาวเกิน 5,000 ตัวอักษร' };
    return { value: value.trim() };
  }
  if (field.type === 'date') {
    if (typeof value !== 'string' || !isValidDateOnly(value)) return { error: 'กรุณาระบุวันที่รูปแบบ YYYY-MM-DD' };
    return { value };
  }
  if (field.type === 'datetime') {
    if (!isValidLocalDateTime(value)) return { error: 'กรุณาระบุวันและเวลาให้ถูกต้อง' };
    return { value };
  }
  if (field.type === 'integer' || field.type === 'number' || field.type === 'percentage') {
    const number = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(number)) return { error: 'ต้องเป็นตัวเลข' };
    if (field.type === 'integer' && !Number.isInteger(number)) return { error: 'ต้องเป็นจำนวนเต็ม' };
    return { value: number };
  }
  if (field.type === 'boolean') {
    if (value !== true && value !== false) return { error: 'ต้องเป็น true หรือ false' };
    return { value };
  }
  return { error: 'ไม่รองรับชนิดข้อมูลนี้' };
}

function validateSubmission(body, schema) {
  const errors = {};
  if (!isPlainObject(body)) return { valid: false, errors: { _form: 'รูปแบบคำขอไม่ถูกต้อง' } };
  const sheetName = body.sheet_name;
  const requestId = body.request_id;
  const dataset = schema.datasets.find((item) => item.name === sheetName);
  if (!dataset) errors.sheet_name = 'ไม่พบชุดข้อมูลที่รับการกรอก';
  if (typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    errors.request_id = 'request_id ต้องเป็น UUID';
  }
  if (!isPlainObject(body.data)) errors._form = 'data ต้องเป็นออบเจ็กต์';
  if (!dataset || !isPlainObject(body.data)) return { valid: false, errors };

  const allowedKeys = new Set(dataset.fields.map((field) => field.key));
  for (const key of Object.keys(body.data)) {
    if (!allowedKeys.has(key)) errors[key] = 'คอลัมน์นี้ไม่มีในชีตต้นฉบับ';
  }
  const data = {};
  for (const field of dataset.fields) {
    const rawValue = body.data[field.key];
    if (field.hidden) {
      data[field.key] = null;
      continue;
    }
    if (field.required && isBlank(rawValue)) {
      errors[field.key] = 'จำเป็นต้องกรอก';
      data[field.key] = null;
      continue;
    }
    const lookupOptions = getLookupOptions(field, schema);
    const result = normaliseField(field, rawValue);
    if (result.error) errors[field.key] = result.error;
    else if (result.value !== null && field.min !== null && field.min !== undefined && result.value < field.min) {
      errors[field.key] = `ต้องไม่น้อยกว่า ${field.min}`;
    }
    else if (field.max !== null && field.max !== undefined && result.value > field.max) {
      errors[field.key] = `ต้องไม่เกิน ${field.max}`;
    }
    else if ((field.options || []).length && result.value !== null && !field.options.includes(String(result.value))) {
      errors[field.key] = 'กรุณาเลือกค่าจากรายการอ้างอิง';
    } else if (lookupOptions.length && result.value !== null
      && !lookupOptions.some((option) => option.value === String(result.value))) {
      errors[field.key] = 'กรุณาเลือกที่พักจากรายการ';
    } else data[field.key] = result.value;
  }

  if (dataset.validPairs?.length && data.Neighbourhood && data.Room_Type
    && !dataset.validPairs.some((pair) => pair.neighbourhood === data.Neighbourhood && pair.room_type === data.Room_Type)) {
    errors.Room_Type = 'ประเภทห้องนี้ไม่มีใน tblLookup สำหรับเขตที่เลือก';
  }

  const listingField = dataset.fields.find((field) => field.key === 'listing_id');
  const selectedListing = listingField
    ? getLookupOptions(listingField, schema).find((option) => option.value === data.listing_id)
    : null;
  if (selectedListing) {
    for (const field of dataset.fields.filter((item) => item.autoMapped)) {
      data[field.key] = selectedListing.mappedValues?.[field.key] ?? null;
    }
  }

  if (data.minimum_nights !== null && data.maximum_nights !== null
    && data.minimum_nights > data.maximum_nights) {
    errors.maximum_nights = 'จำนวนคืนสูงสุดต้องไม่น้อยกว่าจำนวนคืนขั้นต่ำ';
  }

  for (const [startKey, endKey] of [
    ['calendar_start_date', 'calendar_end_date'],
    ['first_review_date', 'last_review_date'],
  ]) {
    if (data[startKey] && data[endKey] && data[startKey] > data[endKey]) {
      errors[endKey] = 'วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น';
    }
  }
  return { valid: Object.keys(errors).length === 0, errors, value: { sheetName, requestId, data } };
}

module.exports = { validateSubmission, isValidDateOnly, isValidLocalDateTime };
