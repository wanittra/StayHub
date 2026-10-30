'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');

const COMMENTS = [
  'ห้องพักสะอาดและบรรยากาศโดยรวมดี เดินทางค่อนข้างสะดวก',
  'ที่พักตรงกับรายละเอียด เหมาะสำหรับพักผ่อนและเดินทางในกรุงเทพฯ',
  'ทำเลดี ใกล้ร้านอาหาร ห้องเป็นสัดส่วนและดูแลเรียบร้อย',
  'การเช็กอินสะดวก ที่พักเงียบและเป็นส่วนตัวกว่าที่คาดไว้',
  'พื้นที่ใช้งานกำลังดี อุปกรณ์พื้นฐานครบ และเดินทางไม่ยุ่งยาก',
  'ประสบการณ์โดยรวมดี เหมาะกับการพักระยะสั้นและท่องเที่ยวในเมือง',
  'ห้องดูเป็นระเบียบ บรรยากาศสบาย และเจ้าของให้ข้อมูลชัดเจน',
  'ชอบทำเลและความเป็นส่วนตัว โดยรวมถือว่าคุ้มค่ากับการเข้าพัก',
];

function stableHash(listingId, date, index) {
  const seed = `${listingId}:${date}:${index}`;
  let hash = 0;
  for (const character of seed) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return hash;
}

function createMockReview(listingId, date, index, options = {}) {
  const { dataSource = 'mock', includeDate = true } = options;
  const hash = stableHash(listingId, date, index);
  const hour = 8 + (hash % 14);
  const minute = Math.floor(hash / 14) % 60;
  const createdAt = `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+07:00`;

  return {
    review_id: `mock-${crypto.createHash('sha1').update(`${listingId}:${date}:${index}`).digest('hex').slice(0, 20)}`,
    request_id: `mock-${listingId}-${date}-${index}`,
    listing_id: String(listingId),
    ...(includeDate ? { date } : {}),
    rating: 3 + (hash % 3),
    comment: COMMENTS[hash % COMMENTS.length],
    reviewer: {
      id: `mock-${hash}`,
      name: `ผู้เข้าพัก •••${String((hash % 90) + 10).padStart(2, '0')}`,
      role: 'guest',
    },
    created_at: createdAt,
    data_source: dataSource,
    is_mock: true,
  };
}

function csvValue(value) {
  const text = value == null ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

async function readExistingWebReviews(filePath) {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return Array.isArray(parsed.reviews) ? parsed.reviews.filter((review) => !review.is_mock) : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

module.exports = { createMockReview, csvValue, readExistingWebReviews };
