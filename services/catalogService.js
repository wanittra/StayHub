const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const NUMBER_FIELDS = new Set([
  'latitude', 'longitude', 'price', 'minimum_nights', 'number_of_reviews',
  'reviews_per_month', 'calculated_host_listings_count', 'availability_365',
  'number_of_reviews_ltm',
]);

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      values.push(value);
      value = '';
    } else value += character;
  }
  values.push(value);
  return values;
}

function normaliseListing(headers, values) {
  const record = {};
  headers.forEach((header, index) => {
    const raw = values[index] ?? '';
    if (NUMBER_FIELDS.has(header)) record[header] = raw === '' ? null : Number(raw);
    else record[header] = raw === '' ? null : raw;
  });
  record.id = String(record.id ?? '');
  record.host_id = record.host_id == null ? null : String(record.host_id);
  record.host_profile_id = record.host_profile_id == null ? null : String(record.host_profile_id);
  return record;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function createCatalogService(dataDirectory) {
  const files = {
    listings: path.join(dataDirectory, 'listings.csv'),
    calendarMonthly: path.join(dataDirectory, 'calendar_monthly.csv'),
    reviews: path.join(dataDirectory, 'reviews.csv'),
    geojson: path.join(dataDirectory, 'neighbourhoods.geojson'),
  };
  const activityCachePath = path.join(dataDirectory, '..', '.cache', 'stayhub-activity-index.json');
  let listingsCache = null;
  let listingsMtime = 0;
  let geoJsonCache = null;
  let geoJsonMtime = 0;
  let activityCache = null;
  let activitySignature = '';
  let activityPromise = null;
  let calendarMonthlyCache = null;
  let calendarMonthlyMtime = 0;

  async function loadListings() {
    const stat = await fs.stat(files.listings);
    if (listingsCache && stat.mtimeMs === listingsMtime) return listingsCache;
    const input = fsSync.createReadStream(files.listings, { encoding: 'utf8' });
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    let headers = null;
    const items = [];
    const byId = new Map();
    for await (const line of lines) {
      if (!headers) {
        headers = parseCsvLine(line);
        continue;
      }
      if (!line) continue;
      const item = normaliseListing(headers, parseCsvLine(line));
      if (!item.id) continue;
      items.push(item);
      byId.set(item.id, item);
    }
    const neighbourhoods = [...new Set(items.map((item) => item.neighbourhood).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'en'));
    const roomTypes = [...new Set(items.map((item) => item.room_type).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'en'));
    const prices = items.map((item) => item.price).filter(Number.isFinite);
    listingsCache = {
      items,
      byId,
      filters: {
        neighbourhoods,
        room_types: roomTypes,
        price_min: prices.length ? Math.min(...prices) : null,
        price_max: prices.length ? Math.max(...prices) : null,
      },
      updated_at: stat.mtime.toISOString(),
    };
    listingsMtime = stat.mtimeMs;
    return listingsCache;
  }

  function matchesFilters(item, query) {
    const needle = String(query.q || '').trim().toLocaleLowerCase('th-TH');
    if (needle) {
      const haystack = `${item.id} ${item.name || ''} ${item.host_name || ''} ${item.neighbourhood || ''}`.toLocaleLowerCase('th-TH');
      if (!haystack.includes(needle)) return false;
    }
    if (query.neighbourhood && item.neighbourhood !== query.neighbourhood) return false;
    if (query.room_type && item.room_type !== query.room_type) return false;
    const minPrice = query.min_price === undefined || query.min_price === '' ? null : Number(query.min_price);
    const maxPrice = query.max_price === undefined || query.max_price === '' ? null : Number(query.max_price);
    const maxMinimumNights = query.max_minimum_nights === undefined || query.max_minimum_nights === ''
      ? null : Number(query.max_minimum_nights);
    const minReviews = query.min_reviews === undefined || query.min_reviews === '' ? null : Number(query.min_reviews);
    if (Number.isFinite(minPrice) && (!Number.isFinite(item.price) || item.price < minPrice)) return false;
    if (Number.isFinite(maxPrice) && (!Number.isFinite(item.price) || item.price > maxPrice)) return false;
    if (Number.isFinite(maxMinimumNights)
      && (!Number.isFinite(item.minimum_nights) || item.minimum_nights > maxMinimumNights)) return false;
    if (Number.isFinite(minReviews) && (item.number_of_reviews ?? 0) < minReviews) return false;
    return true;
  }

  function publicListing(item) {
    return {
      id: item.id,
      name: item.name,
      host_name: item.host_name,
      neighbourhood: item.neighbourhood,
      latitude: item.latitude,
      longitude: item.longitude,
      room_type: item.room_type,
      price: item.price,
      minimum_nights: item.minimum_nights,
      number_of_reviews: item.number_of_reviews,
      last_review: item.last_review,
      reviews_per_month: item.reviews_per_month,
      availability_365: item.availability_365,
      number_of_reviews_ltm: item.number_of_reviews_ltm,
    };
  }

  async function searchListings(query = {}) {
    const catalog = await loadListings();
    const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
    const pageSize = Math.min(48, Math.max(6, Number.parseInt(query.page_size, 10) || 12));
    const matches = catalog.items.filter((item) => matchesFilters(item, query));
    const start = (page - 1) * pageSize;
    const mapLimit = 1200;
    return {
      items: matches.slice(start, start + pageSize).map(publicListing),
      map_items: matches.slice(0, mapLimit).map((item) => ({
        id: item.id, name: item.name, latitude: item.latitude, longitude: item.longitude,
        price: item.price, neighbourhood: item.neighbourhood,
      })),
      map_sampled: matches.length > mapLimit,
      pagination: { page, page_size: pageSize, total: matches.length, pages: Math.ceil(matches.length / pageSize) },
      filters: catalog.filters,
      updated_at: catalog.updated_at,
    };
  }

  async function getListing(id) {
    const catalog = await loadListings();
    const item = catalog.byId.get(String(id));
    return item ? publicListing(item) : null;
  }

  async function scanReviewFile(filePath, index, monthly) {
    const stat = await fs.stat(filePath);
    const stream = fsSync.createReadStream(filePath);
    let carry = Buffer.alloc(0);
    let carryOffset = 0;
    let header = true;
    let currentId = null;
    let currentStart = null;

    function processLine(buffer, start, endExclusive) {
      if (header) {
        header = false;
        return;
      }
      if (!buffer.length) return;
      const line = buffer.toString('utf8');
      const parts = line.split(',');
      const id = parts[0];
      const date = parts[1];
      if (id !== currentId) {
        if (currentId !== null) index[currentId] = { start: currentStart, end: start - 1 };
        currentId = id;
        currentStart = start;
      }
      const month = date?.slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(month)) {
        const bucket = monthly[month] || { total: 0 };
        bucket.total += 1;
        monthly[month] = bucket;
      }
    }

    for await (const chunk of stream) {
      const data = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      const dataOffset = carry.length ? carryOffset : carryOffset;
      let cursor = 0;
      let newline = data.indexOf(10, cursor);
      while (newline !== -1) {
        processLine(data.subarray(cursor, newline), dataOffset + cursor, dataOffset + newline + 1);
        cursor = newline + 1;
        newline = data.indexOf(10, cursor);
      }
      carry = data.subarray(cursor);
      carryOffset = dataOffset + cursor;
    }
    if (carry.length) processLine(carry, carryOffset, stat.size);
    if (currentId !== null) index[currentId] = { start: currentStart, end: stat.size - 1 };
  }

  async function getActivitySignature() {
    const reviewsStat = await fs.stat(files.reviews);
    return `${reviewsStat.size}:${reviewsStat.mtimeMs}`;
  }

  async function ensureActivityIndex() {
    const signature = await getActivitySignature();
    if (activityCache && activitySignature === signature) return activityCache;
    if (activityPromise) return activityPromise;
    activityPromise = (async () => {
      try {
        const stored = JSON.parse(await fs.readFile(activityCachePath, 'utf8'));
        if (stored.signature === signature && stored.data) {
          activityCache = stored.data;
          activitySignature = signature;
          return activityCache;
        }
      } catch {
        // ไม่มี cache หรือไฟล์ cache ใช้ไม่ได้ ให้สร้างใหม่จาก CSV
      }
      const next = {
        reviews: {}, reviews_monthly: {},
        built_at: new Date().toISOString(),
      };
      await scanReviewFile(files.reviews, next.reviews, next.reviews_monthly);
      activityCache = next;
      activitySignature = signature;
      await fs.mkdir(path.dirname(activityCachePath), { recursive: true });
      await fs.writeFile(activityCachePath, JSON.stringify({ signature, data: next }), 'utf8');
      return next;
    })();
    try { return await activityPromise; } finally { activityPromise = null; }
  }

  async function readIndexedReviews(filePath, range) {
    if (!range) return [];
    const chunks = [];
    for await (const chunk of fsSync.createReadStream(filePath, { start: range.start, end: range.end })) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf8').trim();
    if (!text) return [];
    return text.split('\n').filter(Boolean).map((line) => {
      const values = line.replace(/\r$/, '').split(',');
      return { listing_id: values[0], date: values[1] };
    });
  }

  async function getActivity(id) {
    const listing = await getListing(id);
    if (!listing) return null;
    const activity = await ensureActivityIndex();
    const reviews = await readIndexedReviews(files.reviews, activity.reviews[String(id)]);
    return {
      reviews,
      indexed_at: activity.built_at,
    };
  }

  async function loadCalendarMonths() {
    const stat = await fs.stat(files.calendarMonthly);
    if (calendarMonthlyCache && stat.mtimeMs === calendarMonthlyMtime) return calendarMonthlyCache;
    const text = await fs.readFile(files.calendarMonthly, 'utf8');
    const lines = text.split(/\r?\n/).filter(Boolean);
    const headers = parseCsvLine(lines.shift() || '');
    calendarMonthlyCache = lines.map((line) => {
      const values = parseCsvLine(line);
      return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
    }).filter((row) => row.series_id === 'CITY').map((row) => ({
      month: String(row.month_start || '').slice(0, 7),
      total_days: Number(row.total_days),
      available_days: Number(row.available_days),
      available_ratio: Number(row.available_rate),
      estimated_occupancy_ratio: Number(row.est_occupancy_rate),
    })).sort((a, b) => a.month.localeCompare(b.month));
    calendarMonthlyMtime = stat.mtimeMs;
    return calendarMonthlyCache;
  }

  async function getOverview() {
    const catalog = await loadListings();
    const activity = await ensureActivityIndex();
    const groupCount = (key) => {
      const counts = new Map();
      catalog.items.forEach((item) => {
        const label = item[key] || 'ไม่ระบุ';
        counts.set(label, (counts.get(label) || 0) + 1);
      });
      return [...counts.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
    };
    const prices = catalog.items.map((item) => item.price).filter(Number.isFinite);
    const reviewMonths = Object.entries(activity.reviews_monthly)
      .map(([month, values]) => ({ month, reviews: values.total }))
      .sort((a, b) => a.month.localeCompare(b.month));
    const calendarMonths = await loadCalendarMonths();
    return {
      totals: {
        listings: catalog.items.length,
        neighbourhoods: catalog.filters.neighbourhoods.length,
        median_price: median(prices),
        reviews: catalog.items.reduce((sum, item) => sum + (item.number_of_reviews || 0), 0),
      },
      by_neighbourhood: groupCount('neighbourhood'),
      by_room_type: groupCount('room_type'),
      review_months: reviewMonths,
      calendar_months: calendarMonths,
      updated_at: catalog.updated_at,
      indexed_at: activity.built_at,
    };
  }

  async function getGeoJson() {
    let stat;
    try { stat = await fs.stat(files.geojson); }
    catch (error) {
      if (error.code === 'ENOENT') return { type: 'FeatureCollection', features: [], note: 'ไม่มีไฟล์ neighbourhoods.geojson ในชุดข้อมูลปัจจุบัน' };
      throw error;
    }
    if (geoJsonCache && stat.mtimeMs === geoJsonMtime) return geoJsonCache;
    geoJsonCache = JSON.parse(await fs.readFile(files.geojson, 'utf8'));
    geoJsonMtime = stat.mtimeMs;
    return geoJsonCache;
  }

  return { searchListings, getListing, getActivity, getOverview, getGeoJson };
}

module.exports = { createCatalogService, parseCsvLine };
