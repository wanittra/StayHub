const state = {
  view: 'explore',
  listings: [], mapItems: [], mapSampled: false, filters: null, pagination: null,
  geojson: null, selectedListingId: null, hoveredListingId: null, analyticsLoaded: false, analytics: null,
  schema: null, dataset: null, values: {}, requestId: null, mode: 'local_excel', sent: false,
};

const allowedViews = ['explore', 'analytics', 'manage'];

const elements = Object.fromEntries([...document.querySelectorAll('[id]')].map((element) => [element.id, element]));

function setContainerMessage(container, message) {
  const card = document.createElement('div');
  card.className = 'loading-card';
  card.textContent = message;
  container.replaceChildren(card);
}

function createRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.random() * 16 | 0;
    return (character === 'x' ? random : (random & 0x3 | 0x8)).toString(16);
  });
}

function createSubmissionId() {
  const now = new Date();
  const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((value) => String(value).padStart(2, '0')).join('');
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()].map((value) => String(value).padStart(2, '0')).join('');
  return `SUB-${date}-${time}-${createRequestId().slice(0, 4).toUpperCase()}`;
}

function currentLocalDateTime() {
  const now = new Date();
  const parts = [now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes()]
    .map((value) => String(value).padStart(2, '0'));
  return `${parts[0]}-${parts[1]}-${parts[2]}T${parts[3]}:${parts[4]}`;
}

function formatNumber(value, maximumFractionDigits = 0) {
  return value == null || !Number.isFinite(Number(value))
    ? 'ไม่ระบุ' : Number(value).toLocaleString('th-TH', { maximumFractionDigits });
}

function formatPercent(value, maximumFractionDigits = 1) {
  return value == null || !Number.isFinite(Number(value))
    ? 'ไม่ระบุ' : Number(value).toLocaleString('th-TH', { style: 'percent', maximumFractionDigits });
}

function showGlobalError(message) {
  elements.globalMessage.textContent = message;
  elements.globalMessage.className = 'message global-message error';
  elements.globalMessage.hidden = false;
}

function clearGlobalError() {
  elements.globalMessage.hidden = true;
  elements.globalMessage.textContent = '';
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  let result;
  try { result = await response.json(); } catch { result = null; }
  if (!response.ok) throw new Error(result?.message || `เรียกข้อมูลไม่สำเร็จ (${response.status})`);
  return result;
}

function switchView(view, updateHash = true) {
  if (!allowedViews.includes(view)) view = 'explore';
  state.view = view;
  document.querySelectorAll('.view').forEach((section) => { section.hidden = section.id !== `${view}View`; });
  document.querySelectorAll('.nav-link').forEach((button) => button.classList.toggle('is-active', button.dataset.view === view));
  if (updateHash) history.replaceState(null, '', `#${view}`);
  clearGlobalError();
  if (view === 'analytics' && !state.analyticsLoaded) loadAnalytics();
  if (view === 'manage' && !state.schema) initialiseManagement();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.querySelectorAll('.nav-link').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));

function filterParams(page = 1) {
  const form = new FormData(elements.filterForm);
  const params = new URLSearchParams({ page: String(page), page_size: '12' });
  for (const [key, value] of form.entries()) if (String(value).trim()) params.set(key, String(value).trim());
  return params;
}

function populateFilterOptions(filters) {
  if (state.filters) return;
  state.filters = filters;
  filters.neighbourhoods.forEach((value) => elements.filterNeighbourhood.append(new Option(value, value)));
  filters.room_types.forEach((value) => elements.filterRoomType.append(new Option(value, value)));
}

const roomPhotos = [
  'photo-1590490360182-c33d57733427',
  'photo-1566665797739-1674de7a421a',
  'photo-1582719478250-c89cae4dc85b',
  'photo-1618773928121-c32242e63f39',
  'photo-1591088398332-8a7791972843',
  'photo-1505693416388-ac5ce068fe85',
  'photo-1522771739844-6a9f6d5f14af',
  'photo-1540518614846-7ede433c4ef0',
  'photo-1578683010236-d716f9a3f461',
  'photo-1595526114035-0d45ed16cfbf',
  'photo-1616594039964-ae9021a400a0',
  'photo-1560448204-e02f11c3d0e2',
  'photo-1512918728675-ed5a9ecdebfd',
  'photo-1502672260266-1c1ef2d93688',
  'photo-1613490493576-7fde63acd811',
  'photo-1571896349842-33c89424de2d',
  'photo-1590381105924-c72589b9ef3f',
  'photo-1584132967334-10e028bd69f7',
  'photo-1596394516093-501ba68a0ba6',
  'photo-1507038772120-7ffe76f79d0b',
];

function getRoomImage(seed = Math.random()) {
  const numericSeed = Number(seed);
  const numSeed = Number.isFinite(numericSeed) ? Math.abs(Math.trunc(numericSeed)) : Math.floor(Math.random() * 10000);
  const selectedPhoto = roomPhotos[numSeed % roomPhotos.length];
  return `https://images.unsplash.com/${selectedPhoto}?auto=format&fit=crop&w=800&h=500&q=80`;
}

function localListingImageFor(item) {
  const name = String(item.name || '').toLocaleLowerCase('en');
  const roomType = String(item.room_type || '').toLocaleLowerCase('en');
  if (/waterfront|river|riverside|chaopraya|chao phraya/.test(name)) return { src: '/images/listings/waterfront-home.png', alt: 'ภาพประกอบบ้านหรือคอนโดริมน้ำ' };
  if (/hotel|boutique|suite|resort/.test(name) || roomType === 'hotel room') return { src: '/images/listings/boutique-hotel.png', alt: 'ภาพประกอบห้องพักโรงแรม' };
  if (roomType === 'shared room' || /hostel|dorm|bunk/.test(name)) return { src: '/images/listings/shared-hostel.png', alt: 'ภาพประกอบห้องพักรวม' };
  if (roomType === 'private room') return { src: '/images/listings/private-bedroom.png', alt: 'ภาพประกอบห้องพักส่วนตัว' };
  if (/view|central|sky|high|flr|condo/.test(name)) return { src: '/images/listings/city-apartment.png', alt: 'ภาพประกอบอพาร์ตเมนต์วิวเมือง' };
  return { src: '/images/listings/modern-living.png', alt: 'ภาพประกอบบ้านหรืออพาร์ตเมนต์ทั้งหลัง' };
}

function listingImageFor(item) {
  const fallback = localListingImageFor(item);
  return { src: getRoomImage(Number(item.id)), fallback: fallback.src, alt: `ภาพประกอบห้องพักของ ${item.name || `listing_id ${item.id}`}` };
}

function createListingImage(item, className = 'listing-media') {
  const imageInfo = listingImageFor(item);
  const figure = document.createElement('figure'); figure.className = className;
  const image = document.createElement('img'); image.src = imageInfo.src; image.alt = imageInfo.alt; image.loading = 'lazy'; image.decoding = 'async';
  image.referrerPolicy = 'no-referrer';
  const badge = document.createElement('figcaption'); badge.textContent = 'ภาพประกอบจาก Unsplash';
  let fallbackUsed = false;
  image.addEventListener('error', () => {
    if (!fallbackUsed && imageInfo.fallback) {
      fallbackUsed = true; image.src = imageInfo.fallback; badge.textContent = 'ภาพสำรองในเครื่อง'; return;
    }
    figure.classList.add('image-unavailable'); image.remove(); badge.textContent = 'ไม่มีภาพประกอบ';
  });
  figure.append(image, badge);
  return figure;
}

function selectListingOnMap(item, scrollToMap = false) {
  state.selectedListingId = item.id;
  document.querySelectorAll('.listing-card').forEach((card) => {
    const selected = String(card.dataset.id) === String(item.id);
    card.classList.toggle('is-selected', selected);
    card.setAttribute('aria-selected', String(selected));
  });
  elements.mapNote.textContent = `กำลังแสดงที่พักที่เลือก: listing_id ${item.id} · ${item.neighbourhood || 'ไม่ระบุเขต'} · ไม่มีหมุดรายการอื่น`;
  drawMap();
  if (scrollToMap) elements.mapCanvas.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function previewListingOnMap(item) {
  state.hoveredListingId = item.id;
  elements.mapNote.textContent = `กำลังชี้ที่: listing_id ${item.id} · ${item.neighbourhood || 'ไม่ระบุเขต'} · คลิกเพื่อเลือกค้างไว้`;
  drawMap();
}

function clearListingPreview() {
  state.hoveredListingId = null;
  const selected = state.mapItems.find((item) => String(item.id) === String(state.selectedListingId))
    || state.listings.find((item) => String(item.id) === String(state.selectedListingId));
  elements.mapNote.textContent = selected
    ? `กำลังแสดงที่พักที่เลือก: listing_id ${selected.id} · ${selected.neighbourhood || 'ไม่ระบุเขต'} · ไม่มีหมุดรายการอื่น`
    : `ภาพประกอบพื้นที่กรุงเทพฯ สำหรับดูบริบทของข้อมูล ${formatNumber(state.pagination?.total)} แห่งตามตัวกรอง · ชี้หรือคลิกการ์ดเพื่อแสดงบนแผนที่`;
  drawMap();
}

function createListingCard(item) {
  const article = document.createElement('article');
  article.className = 'listing-card';
  article.dataset.id = item.id;
  article.tabIndex = 0;
  article.setAttribute('aria-label', `เลือก ${item.name || `listing_id ${item.id}`} เพื่อแสดงบนแผนที่`);
  article.setAttribute('aria-selected', String(String(state.selectedListingId) === String(item.id)));
  article.classList.toggle('is-selected', String(state.selectedListingId) === String(item.id));
  const id = document.createElement('span');
  id.className = 'listing-id';
  id.textContent = `listing_id ${item.id}`;
  const title = document.createElement('h3');
  title.textContent = item.name || 'ไม่ระบุชื่อที่พัก';
  const location = document.createElement('p');
  location.className = 'location';
  location.textContent = `${item.neighbourhood || 'ไม่ระบุเขต'} · ${item.room_type || 'ไม่ระบุประเภท'}`;
  const media = createListingImage(item);
  const facts = document.createElement('div');
  facts.className = 'listing-facts';
  [`ราคา ${formatNumber(item.price)}`, `ขั้นต่ำ ${formatNumber(item.minimum_nights)} คืน`,
    `${formatNumber(item.number_of_reviews)} รีวิว`, `ว่าง ${formatNumber(item.availability_365)} วัน/ปี`]
    .forEach((text) => { const span = document.createElement('span'); span.textContent = text; facts.append(span); });
  const actions = document.createElement('div'); actions.className = 'card-actions';
  const mapButton = document.createElement('button');
  mapButton.type = 'button'; mapButton.className = 'button button-secondary card-map-action'; mapButton.textContent = 'แสดงบนแผนที่';
  mapButton.addEventListener('click', (event) => { event.stopPropagation(); selectListingOnMap(item, true); });
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button button-quiet card-action';
  button.textContent = 'ดูรายละเอียด';
  button.addEventListener('click', (event) => { event.stopPropagation(); openListingDetail(item); });
  actions.append(mapButton, button);
  article.addEventListener('click', (event) => { if (!event.target.closest('button')) selectListingOnMap(item, true); });
  article.addEventListener('mouseenter', () => previewListingOnMap(item));
  article.addEventListener('mouseleave', clearListingPreview);
  article.addEventListener('focusin', () => previewListingOnMap(item));
  article.addEventListener('focusout', (event) => { if (!article.contains(event.relatedTarget)) clearListingPreview(); });
  article.addEventListener('keydown', (event) => {
    if (event.target !== article || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault(); selectListingOnMap(item, true);
  });
  article.append(id, title, location, media, facts, actions);
  return article;
}

function renderListings(result) {
  state.listings = result.items;
  state.mapItems = result.map_items;
  state.mapSampled = result.map_sampled;
  state.pagination = result.pagination;
  populateFilterOptions(result.filters);
  elements.resultCount.textContent = `พบ ${formatNumber(result.pagination.total)} แห่ง`;
  elements.dataUpdated.textContent = `ข้อมูล listings อัปเดต ${new Date(result.updated_at).toLocaleString('th-TH')}`;
  elements.mapNote.textContent = `ภาพประกอบพื้นที่กรุงเทพฯ สำหรับดูบริบทของข้อมูล ${formatNumber(result.pagination.total)} แห่งตามตัวกรอง · ชี้หรือคลิกการ์ดเพื่อแสดงบนแผนที่`;
  elements.listingGrid.replaceChildren();
  if (!result.items.length) {
    const empty = document.createElement('div');
    empty.className = 'loading-card';
    empty.textContent = 'ไม่พบที่พักตามเงื่อนไข ลองลดจำนวนตัวกรอง';
    elements.listingGrid.append(empty);
  } else result.items.forEach((item) => elements.listingGrid.append(createListingCard(item)));
  const { page, pages } = result.pagination;
  elements.pageStatus.textContent = `หน้า ${page} จาก ${Math.max(pages, 1)}`;
  elements.previousPage.disabled = page <= 1;
  elements.nextPage.disabled = page >= pages;
  drawMap();
}

async function loadListings(page = 1) {
  setContainerMessage(elements.listingGrid, 'กำลังค้นหาที่พัก…');
  try { renderListings(await fetchJson(`/api/catalog/listings?${filterParams(page)}`)); }
  catch (error) { showGlobalError(error.message); setContainerMessage(elements.listingGrid, 'อ่านข้อมูลไม่สำเร็จ'); }
}

elements.filterForm.addEventListener('submit', (event) => { event.preventDefault(); loadListings(1); });
elements.resetFilters.addEventListener('click', () => { elements.filterForm.reset(); loadListings(1); });
elements.previousPage.addEventListener('click', () => loadListings(state.pagination.page - 1));
elements.nextPage.addEventListener('click', () => loadListings(state.pagination.page + 1));

function mapBounds() { return { minLon: 100.3, maxLon: 100.95, minLat: 13.45, maxLat: 14.05 }; }

function flatMapProjector(width, height) {
  const bounds = mapBounds();
  const padding = Math.max(10, Math.min(width, height) * .025);
  const normalized = (u, v) => [padding + u * (width - padding * 2), padding + v * (height - padding * 2)];
  const geographic = ([lon, lat]) => normalized(
    (lon - bounds.minLon) / (bounds.maxLon - bounds.minLon),
    1 - ((lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)),
  );
  return { normalized, geographic };
}

function canvasPolygon(context, points, fill, stroke = null, lineWidth = 1) {
  context.beginPath();
  points.forEach(([x, y], index) => { if (index) context.lineTo(x, y); else context.moveTo(x, y); });
  context.closePath();
  if (fill) { context.fillStyle = fill; context.fill(); }
  if (stroke) { context.strokeStyle = stroke; context.lineWidth = lineWidth; context.stroke(); }
}

function drawFlatRoad(context, project, points, width = 5, color = '#ffffff') {
  const projected = points.map(([u, v]) => project(u, v));
  context.save(); context.lineCap = 'round'; context.lineJoin = 'round';
  context.beginPath(); projected.forEach(([x, y], index) => { if (index) context.lineTo(x, y); else context.moveTo(x, y); });
  context.strokeStyle = '#c9d1d8'; context.lineWidth = width + 3; context.stroke();
  context.strokeStyle = color; context.lineWidth = width; context.stroke(); context.restore();
}

function drawStreetLabel(context, project, u, v, text, angle = 0, strong = false) {
  const [x, y] = project(u, v);
  context.save(); context.translate(x, y); context.rotate(angle);
  context.textAlign = 'center'; context.textBaseline = 'middle';
  context.font = `${strong ? 700 : 550} ${strong ? 13 : 9}px system-ui`;
  context.lineWidth = 4; context.strokeStyle = 'rgba(246,248,249,.95)'; context.strokeText(text, 0, 0);
  context.fillStyle = strong ? '#536875' : '#657680'; context.fillText(text, 0, 0); context.restore();
}

function drawFlatCityScene(context, width, height, projector) {
  const project = projector.normalized;
  context.fillStyle = '#eef1f3'; context.fillRect(0, 0, width, height);

  canvasPolygon(context, [[.02,.04],[.35,.03],[.42,.24],[.28,.35],[.05,.29]].map(([u,v]) => project(u,v)), '#d8f0dc');
  canvasPolygon(context, [[.68,.02],[.98,.02],[.98,.29],[.82,.34],[.70,.22]].map(([u,v]) => project(u,v)), '#d5efdb');
  canvasPolygon(context, [[.04,.68],[.25,.62],[.35,.76],[.29,.97],[.02,.97]].map(([u,v]) => project(u,v)), '#dcefd8');
  canvasPolygon(context, [[.70,.69],[.97,.62],[.98,.96],[.65,.97]].map(([u,v]) => project(u,v)), '#d3ecd9');

  const river = [project(.53,-.08), project(.50,.12), project(.57,.30), project(.55,.48), project(.64,.66), project(.60,.84), project(.67,1.08)];
  context.save(); context.lineCap = 'round'; context.lineJoin = 'round';
  context.beginPath(); river.forEach(([x,y], index) => { if (index) context.lineTo(x,y); else context.moveTo(x,y); });
  context.strokeStyle = '#7bcddd'; context.lineWidth = Math.max(52, width * .075); context.stroke();
  context.strokeStyle = '#91d9e4'; context.lineWidth = Math.max(36, width * .055); context.stroke(); context.restore();

  const minorVerticals = [.07,.15,.24,.33,.43,.72,.82,.91];
  minorVerticals.forEach((u, index) => drawFlatRoad(context, project, [[u,-.03],[u + (index % 2 ? .05 : -.03),.25],[u - .02,.52],[u + .04,.75],[u,1.03]], 3.2));
  const minorHorizontals = [.10,.20,.31,.42,.55,.67,.79,.90];
  minorHorizontals.forEach((v, index) => drawFlatRoad(context, project, [[-.03,v],[.22,v + .03],[.45,v - .02],[.70,v + (index % 2 ? .03 : -.02)],[1.03,v]], 3.2));
  [
    [[.02,.47],[.18,.40],[.35,.38],[.50,.34],[.69,.29],[.98,.25]],
    [[.08,.98],[.14,.78],[.29,.64],[.44,.56],[.69,.51],[.94,.39]],
    [[.22,.02],[.31,.20],[.38,.38],[.45,.60],[.55,.78],[.72,.96]],
    [[.65,.02],[.69,.20],[.76,.40],[.79,.61],[.89,.83],[1.02,.93]],
  ].forEach((road) => drawFlatRoad(context, project, road, 7, '#f8fafb'));

  drawFlatRoad(context, project, [[-.04,.28],[.18,.29],[.38,.25],[.54,.26],[.75,.20],[1.04,.18]], 11, '#7794ad');
  drawFlatRoad(context, project, [[.02,.76],[.24,.73],[.43,.69],[.58,.70],[.78,.75],[1.02,.72]], 9, '#8da5b8');
  drawFlatRoad(context, project, [[.18,1.02],[.21,.81],[.28,.59],[.34,.39],[.43,.18],[.48,-.03]], 8, '#8da5b8');

  [[.13,.14,'สวนสาธารณะ'],[.82,.13,'สวนจตุจักร'],[.17,.83,'สวนชุมชน'],[.84,.84,'พื้นที่สีเขียว']].forEach(([u,v,label]) => {
    const [x,y] = project(u,v); context.fillStyle = '#388e65'; context.font = '600 9px system-ui'; context.textAlign = 'center'; context.fillText(label,x,y);
  });
  drawStreetLabel(context, project, .50, .50, 'กรุงเทพมหานคร', 0, true);
  drawStreetLabel(context, project, .22, .28, 'ราชเทวี', 0, true);
  drawStreetLabel(context, project, .76, .42, 'คลองเตย', 0, true);
  drawStreetLabel(context, project, .31, .70, 'บางรัก', 0, true);
  drawStreetLabel(context, project, .70, .78, 'สาทร', 0, true);
  drawStreetLabel(context, project, .18, .45, 'ถนนพหลโยธิน', -.28);
  drawStreetLabel(context, project, .73, .22, 'ถนนรัชดาภิเษก', -.08);
  drawStreetLabel(context, project, .80, .71, 'ถนนพระราม 4', .12);
  drawStreetLabel(context, project, .57, .60, 'แม่น้ำเจ้าพระยา', 1.28);

  const shield = project(.60,.255);
  context.fillStyle = '#78933a'; context.beginPath(); context.roundRect(shield[0]-13, shield[1]-8, 26, 16, 4); context.fill();
  context.fillStyle = '#fff'; context.font = '700 9px system-ui'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText('BKK', shield[0], shield[1]);
}

function fitCanvasText(context, value, maxWidth) {
  const text = String(value ?? '');
  if (context.measureText(text).width <= maxWidth) return text;

  const ellipsis = '…';
  let lowerBound = 0;
  let upperBound = text.length;

  while (lowerBound < upperBound) {
    const length = Math.ceil((lowerBound + upperBound) / 2);
    const candidate = `${text.slice(0, length).trimEnd()}${ellipsis}`;
    if (context.measureText(candidate).width <= maxWidth) lowerBound = length;
    else upperBound = length - 1;
  }

  return `${text.slice(0, lowerBound).trimEnd()}${ellipsis}`;
}

function drawSelectedListing(context, project, item, width) {
  const longitude = Number(item.longitude);
  const latitude = Number(item.latitude);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return;

  const [x, y] = project([longitude, latitude]);
  const labelWidth = Math.min(width < 600 ? 148 : 188, width - 24);
  const labelX = Math.max(labelWidth / 2 + 8, Math.min(width - labelWidth / 2 - 8, x));
  const labelY = Math.max(30, y - 76);

  context.save();
  context.beginPath();
  context.ellipse(x, y + 4, 13, 5, 0, 0, Math.PI * 2);
  context.fillStyle = 'rgba(111,60,34,.24)';
  context.fill();

  context.beginPath();
  context.moveTo(x, y);
  context.bezierCurveTo(x - 5, y - 11, x - 16, y - 18, x - 16, y - 30);
  context.arc(x, y - 30, 16, Math.PI, 0);
  context.bezierCurveTo(x + 16, y - 18, x + 5, y - 11, x, y);
  context.closePath();
  context.fillStyle = '#d96135';
  context.fill();
  context.strokeStyle = '#fffdf7';
  context.lineWidth = 3;
  context.stroke();

  context.beginPath();
  context.arc(x, y - 30, 5, 0, Math.PI * 2);
  context.fillStyle = '#fff';
  context.fill();

  context.beginPath();
  context.moveTo(x, y - 43);
  context.lineTo(labelX, labelY + 23);
  context.strokeStyle = 'rgba(118,72,46,.55)';
  context.lineWidth = 1.2;
  context.stroke();

  context.shadowColor = 'rgba(70,55,35,.2)';
  context.shadowBlur = 9;
  context.shadowOffsetY = 3;
  context.fillStyle = 'rgba(255,253,246,.98)';
  context.beginPath();
  context.roundRect(labelX - labelWidth / 2, labelY, labelWidth, 46, 8);
  context.fill();
  context.shadowColor = 'transparent';
  context.strokeStyle = '#d7b99a';
  context.lineWidth = 1;
  context.stroke();

  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#8c3f25';
  context.font = '800 11px system-ui';
  const listingName = item.name || `ที่พัก ${item.id}`;
  const displayName = fitCanvasText(context, listingName, labelWidth - 16);
  context.fillText(displayName, labelX, labelY + 15);

  context.fillStyle = '#55483a';
  context.font = '600 9px system-ui';
  context.fillText(item.neighbourhood || 'ที่พักที่เลือก', labelX, labelY + 32);
  context.restore();
}

function drawMap() {
  const canvas = elements.mapCanvas;
  if (!canvas) return;
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 800;
  const height = canvas.clientHeight || 360;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  }
  const context = canvas.getContext('2d');
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  const projector = flatMapProjector(width, height);
  const project = projector.geographic;
  drawFlatCityScene(context, width, height, projector);
  if (state.geojson) {
    context.fillStyle = 'rgba(255,255,255,.08)'; context.strokeStyle = 'rgba(58,112,94,.25)'; context.lineWidth = .7;
    state.geojson.features.forEach((feature) => {
      const polygons = feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates : [feature.geometry.coordinates];
      polygons.forEach((polygon) => polygon.forEach((ring) => {
        context.beginPath();
        ring.forEach((coordinate, index) => { const [x, y] = project(coordinate); if (index) context.lineTo(x, y); else context.moveTo(x, y); });
        context.closePath(); context.fill(); context.stroke();
      }));
    });
  }
  const activeListingId = state.hoveredListingId ?? state.selectedListingId;
  const selectedItem = state.mapItems.find((item) => String(item.id) === String(activeListingId))
    || state.listings.find((item) => String(item.id) === String(activeListingId));
  if (selectedItem) drawSelectedListing(context, project, selectedItem, width);
}

window.addEventListener('resize', drawMap);

function detailFact(label, value) {
  const wrapper = document.createElement('div');
  const term = document.createElement('dt'); term.textContent = label;
  const description = document.createElement('dd'); description.textContent = value;
  wrapper.append(term, description); return wrapper;
}

function renderCalendar(activity, container) {
  if (!activity.calendar.length) {
    const heading = document.createElement('div'); heading.className = 'calendar-toolbar';
    const title = document.createElement('h3'); title.textContent = 'ข้อมูลปฏิทิน'; heading.append(title);
    const note = document.createElement('p'); note.className = 'data-note';
    note.textContent = activity.calendar_note || 'ไม่มีข้อมูลปฏิทินรายวันในชุดข้อมูลปัจจุบัน';
    container.append(heading, note);
    return;
  }
  const months = [...new Set(activity.calendar.map((row) => row.date.slice(0, 7)))].sort();
  const heading = document.createElement('div'); heading.className = 'calendar-toolbar';
  const title = document.createElement('h3'); title.textContent = 'ปฏิทินสถานะรายวัน';
  const select = document.createElement('select'); select.setAttribute('aria-label', 'เลือกเดือนในปฏิทิน');
  months.forEach((month) => select.append(new Option(month, month)));
  heading.append(title, select);
  const grid = document.createElement('div'); grid.className = 'calendar-grid';
  const note = document.createElement('p'); note.className = 'data-note';

  function drawMonth() {
    grid.replaceChildren();
    const month = select.value;
    if (!month) { grid.textContent = 'ไม่มีข้อมูลปฏิทินสำหรับที่พักนี้'; return; }
    const [year, monthNumber] = month.split('-').map(Number);
    const firstDay = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
    const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    const byDate = new Map(activity.calendar.map((row) => [row.date, row]));
    for (let blank = 0; blank < firstDay; blank += 1) { const cell = document.createElement('div'); grid.append(cell); }
    for (let day = 1; day <= days; day += 1) {
      const date = `${month}-${String(day).padStart(2, '0')}`;
      const row = byDate.get(date);
      const cell = document.createElement('div');
      cell.className = `calendar-day ${row ? (row.available === 't' ? 'is-open' : 'is-closed') : 'is-missing'}`;
      const number = document.createElement('strong'); number.textContent = String(day);
      const status = document.createElement('span'); status.textContent = row ? (row.available === 't' ? 'เปิดให้จอง' : 'ไม่เปิดให้จอง') : 'ไม่มีข้อมูล';
      cell.title = row ? `ขั้นต่ำ ${row.minimum_nights} คืน · สูงสุด ${row.maximum_nights} คืน` : 'ไม่มีข้อมูลสำหรับวันนี้';
      cell.append(number, status); grid.append(cell);
    }
    note.textContent = 'แตะหรือชี้วันที่เพื่อดูจำนวนคืนขั้นต่ำ–สูงสุด';
  }
  select.addEventListener('change', drawMonth);
  drawMonth();
  container.append(heading, grid, note);
}

async function openListingDetail(item) {
  selectListingOnMap(item, false);
  elements.listingDetail.replaceChildren();
  const hero = document.createElement('div'); hero.className = 'detail-hero';
  const id = document.createElement('span'); id.className = 'listing-id'; id.textContent = `listing_id ${item.id}`;
  const title = document.createElement('h2'); title.textContent = item.name || 'ไม่ระบุชื่อที่พัก';
  const subtitle = document.createElement('p'); subtitle.textContent = `${item.neighbourhood || 'ไม่ระบุเขต'} · ${item.room_type || 'ไม่ระบุประเภท'}`;
  hero.append(id, title, subtitle);
  const heroImage = createListingImage(item, 'detail-listing-media');
  const body = document.createElement('div'); body.className = 'detail-body';
  const facts = document.createElement('dl'); facts.className = 'detail-facts';
  facts.append(
    detailFact('เจ้าของที่พัก', item.host_name || 'ไม่ระบุ'),
    detailFact('ราคาในชุดข้อมูล', formatNumber(item.price)),
    detailFact('คืนขั้นต่ำ', `${formatNumber(item.minimum_nights)} คืน`),
    detailFact('จำนวนรีวิว', formatNumber(item.number_of_reviews)),
    detailFact('พร้อมให้บริการใน 365 วัน', `${formatNumber(item.availability_365)} วัน`),
    detailFact('พิกัด', item.latitude == null ? 'ไม่ระบุ' : `${item.latitude}, ${item.longitude}`),
  );
  const activityBox = document.createElement('div'); activityBox.className = 'activity-status';
  activityBox.textContent = 'กำลังอ่านข้อมูลปฏิทิน…';
  body.append(facts, activityBox); elements.listingDetail.append(hero, heroImage, body);
  elements.listingDialog.showModal();
  try {
    const activity = await fetchJson(`/api/catalog/listings/${encodeURIComponent(item.id)}/activity`);
    activityBox.remove();
    renderCalendar(activity, body);
  } catch (error) { activityBox.textContent = error.message; }
}

elements.closeDialog.addEventListener('click', () => elements.listingDialog.close());
elements.listingDialog.addEventListener('click', (event) => { if (event.target === elements.listingDialog) elements.listingDialog.close(); });

function appendMetric(container, label, value) {
  const card = document.createElement('article');
  card.className = 'metric';
  const span = document.createElement('span'); span.textContent = label;
  const strong = document.createElement('strong'); strong.textContent = value;
  card.append(span, strong); container.append(card);
}

function renderSummaryBars(container, values, labels) {
  container.replaceChildren();
  const total = Object.values(values).reduce((sum, value) => sum + Number(value || 0), 0);
  Object.entries(labels).forEach(([key, label]) => {
    const value = Number(values[key] || 0);
    const percent = total ? value / total : 0;
    const row = document.createElement('div'); row.className = 'summary-bar-row';
    const heading = document.createElement('div');
    const name = document.createElement('strong'); name.textContent = label;
    const count = document.createElement('span'); count.textContent = `${formatNumber(value)} รายการ · ${formatPercent(percent, 0)}`;
    heading.append(name, count);
    const track = document.createElement('div'); track.className = 'summary-bar-track';
    const fill = document.createElement('span'); fill.className = `summary-bar-fill ${key.toLowerCase()}`; fill.style.width = `${percent * 100}%`;
    track.append(fill); row.append(heading, track); container.append(row);
  });
}

function renderOccupancyComparison(summary) {
  elements.occupancyComparison.replaceChildren();
  [
    ['อัตราคุ้มทุนเฉลี่ย', summary.average_break_even_occupancy, 'break-even'],
    ['อัตราตลาดเฉลี่ย', summary.average_market_occupancy, 'market'],
  ].forEach(([label, value, className]) => {
    const row = document.createElement('div'); row.className = 'occupancy-row';
    const heading = document.createElement('div');
    const name = document.createElement('span'); name.textContent = label;
    const result = document.createElement('strong'); result.textContent = formatPercent(value, 1);
    heading.append(name, result);
    const track = document.createElement('div'); track.className = 'summary-bar-track';
    const fill = document.createElement('span'); fill.className = `summary-bar-fill ${className}`; fill.style.width = `${Math.max(0, Math.min(1, Number(value) || 0)) * 100}%`;
    track.append(fill); row.append(heading, track); elements.occupancyComparison.append(row);
  });
}

function formatSubmissionTimestamp(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value || 'ไม่ระบุ')
    : date.toLocaleString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function renderSubmissionTable(rows) {
  elements.submissionAnalysisBody.replaceChildren();
  if (!rows.length) {
    const row = document.createElement('tr'); const cell = document.createElement('td');
    cell.colSpan = 7; cell.textContent = 'ยังไม่มีข้อมูลประเมินที่พัก'; row.append(cell); elements.submissionAnalysisBody.append(row); return;
  }
  rows.forEach((item) => {
    const row = document.createElement('tr');
    const values = [
      formatSubmissionTimestamp(item.timestamp),
      `${item.neighbourhood || 'ไม่ระบุ'} · ${item.room_type || 'ไม่ระบุ'}`,
      formatNumber(item.market_median_price, 2),
      `${formatPercent(item.price_percentile, 1)} · ${item.price_status || 'ไม่ระบุ'}`,
      formatPercent(item.break_even_occupancy, 1),
      formatNumber(item.goal_seek_target_price, 2),
    ];
    values.forEach((value) => { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); });
    const verdictCell = document.createElement('td'); const chip = document.createElement('span');
    const feasible = item.feasibility_verdict?.startsWith('FEASIBLE');
    chip.className = `status-chip ${feasible ? 'pass' : 'warn'}`;
    chip.textContent = feasible ? 'มีความเป็นไปได้' : 'มีความเสี่ยง';
    verdictCell.append(chip); row.append(verdictCell); elements.submissionAnalysisBody.append(row);
  });
}

function renderAnalytics(data) {
  state.analytics = data;
  const analysis = data.submissions_analysis;
  const sourceMain = document.createElement('span');
  const sourceStrong = document.createElement('strong'); sourceStrong.textContent = data.source.file;
  sourceMain.append('แหล่งข้อมูล: ', sourceStrong, ' · ตาราง tblSubmissions');
  const sourceNote = document.createElement('span'); sourceNote.textContent = `อัปเดตล่าสุด ${new Date(data.source.saved_at).toLocaleString('th-TH')}`;
  elements.analyticsSource.replaceChildren(sourceMain, sourceNote);

  elements.analyticsMetricGrid.replaceChildren();
  appendMetric(elements.analyticsMetricGrid, 'แบบประเมินทั้งหมด', formatNumber(analysis.summary.total));
  appendMetric(elements.analyticsMetricGrid, 'ราคาเป้าหมายเฉลี่ย', formatNumber(analysis.summary.average_target_price, 2));
  appendMetric(elements.analyticsMetricGrid, 'อัตราคุ้มทุนเฉลี่ย', formatPercent(analysis.summary.average_break_even_occupancy, 1));
  appendMetric(elements.analyticsMetricGrid, 'ผ่านเกณฑ์ตลาด', formatPercent(analysis.summary.feasible_rate, 0));

  renderSummaryBars(elements.feasibilityChart, analysis.feasibility, { FEASIBLE: 'มีความเป็นไปได้', RISKY: 'มีความเสี่ยง' });
  renderSummaryBars(elements.priceStatusChart, analysis.price_status, { NORMAL: 'ราคาปกติ', WARNING: 'ควรตรวจสอบ', ANOMALY: 'ราคาผิดปกติ' });
  renderOccupancyComparison(analysis.summary);
  renderSubmissionTable(analysis.recent);
}

async function loadAnalytics() {
  elements.analyticsLoading.hidden = false;
  elements.analyticsContent.hidden = true;
  try {
    const data = await fetchJson('/api/analytics');
    renderAnalytics(data);
    elements.analyticsLoading.hidden = true;
    elements.analyticsContent.hidden = false;
    state.analyticsLoaded = true;
  } catch (error) {
    elements.analyticsLoading.textContent = error.message;
    showGlobalError(error.message);
  }
}

elements.refreshAnalysis.addEventListener('click', () => {
  state.analyticsLoaded = false;
  loadAnalytics();
});

// ส่วนจัดการข้อมูลใน Excel บนเครื่อง
function setStep(activeStep) {
  document.querySelectorAll('.step').forEach((step) => {
    const number = Number(step.dataset.step);
    step.classList.toggle('is-active', number === activeStep);
    step.classList.toggle('is-complete', number < activeStep);
  });
}

function showManagePanel(name) {
  elements.formPanel.hidden = name !== 'form';
  elements.reviewPanel.hidden = name !== 'review';
  setStep(name === 'form' ? 1 : 2);
}

async function initialiseManagement() {
  setContainerMessage(elements.formFields, 'กำลังอ่านโครงสร้าง Excel…');
  showManagePanel('form');
  try {
    const schema = await fetchJson('/api/schema');
    schema.datasets.forEach((dataset) => dataset.fields.forEach((field) => {
      field.options ||= []; field.suggestions ||= [];
      field.lookupOptions = field.lookup ? (schema.lookups?.[field.lookup] || []) : (field.lookupOptions || []);
    }));
    state.schema = schema;
    const dataset = schema.datasets.find((item) => item.name === 'user_submissions');
    if (!dataset) throw new Error(schema.message || 'ไม่พบแบบประเมินที่พักใน Workbook');
    selectDataset(dataset);
  } catch (error) { elements.formFields.textContent = error.message; showGlobalError(error.message); }
}

function selectDataset(dataset) {
  state.dataset = dataset;
  state.values = Object.fromEntries(dataset.fields.map((field) => {
    if (field.key === 'Submission_ID') return [field.key, createSubmissionId()];
    if (field.key === 'Timestamp') return [field.key, currentLocalDateTime()];
    return [field.key, field.defaultValue || ''];
  }));
  state.requestId = null; state.sent = false;
  elements.sheetName.textContent = dataset.targetSheet || dataset.name;
  elements.fieldCount.textContent = String(dataset.fields.filter((field) => !field.hidden).length);
  renderForm(); clearGlobalError(); showManagePanel('form');
}

function createInput(field) {
  let input;
  if (field.options.length) {
    input = document.createElement('select'); input.append(new Option('เลือกค่า', ''));
    field.options.forEach((option) => input.append(new Option(option === 't' ? 't — เปิดให้จอง' : option === 'f' ? 'f — ไม่เปิดให้จอง' : option, option)));
  } else {
    input = document.createElement('input');
    input.type = field.type === 'date' ? 'date' : field.type === 'datetime' ? 'datetime-local'
      : ['integer', 'number', 'percentage'].includes(field.type) ? 'number' : 'text';
    if (field.type === 'integer') input.step = '1';
    if (field.type === 'number') input.step = 'any';
    if (field.type === 'percentage') { input.step = '0.01'; input.min = '1'; input.max = '100'; }
  }
  input.id = `field-${field.key}`; input.name = field.key; input.required = field.required;
  input.value = state.values[field.key] ?? ''; input.autocomplete = 'off';
  if (field.min != null && field.type !== 'percentage') input.min = String(field.min);
  if (field.lookupOptions?.length) { input.type = 'search'; input.placeholder = 'เลือกจากกล่องข้อมูลที่พัก หรือวาง listing_id'; }
  return input;
}

function setMappedListing(option) {
  const input = elements.dataForm.elements.listing_id;
  if (input) input.value = option.value;
  state.values.listing_id = option.value;
}

function renderListingPicker(field) {
  const box = document.createElement('section'); box.className = 'listing-picker field full';
  const heading = document.createElement('div');
  const kicker = document.createElement('p'); kicker.className = 'section-kicker'; kicker.textContent = 'ข้อมูลที่พัก';
  const title = document.createElement('h3'); title.textContent = 'ค้นหาที่พักก่อนกรอกข้อมูล';
  const description = document.createElement('p'); description.textContent = 'ค้นจากชื่อ เขต หรือ listing_id แล้วตรวจรายละเอียดก่อนเลือก';
  heading.append(kicker, title, description);
  const search = document.createElement('input'); search.type = 'search'; search.className = 'listing-search'; search.placeholder = 'ค้นหาชื่อที่พัก เขต หรือ listing_id'; search.setAttribute('aria-label', 'ค้นหาข้อมูลที่พัก');
  const results = document.createElement('div'); results.className = 'listing-results';
  const detail = document.createElement('div'); detail.className = 'listing-detail'; detail.hidden = true;
  const status = document.createElement('p'); status.className = 'lookup-status'; status.setAttribute('aria-live', 'polite');

  function showDetail(option) {
    detail.replaceChildren(); detail.hidden = false;
    const title = document.createElement('div'); title.className = 'listing-detail-title';
    const name = document.createElement('strong'); name.textContent = option.label;
    const id = document.createElement('code'); id.textContent = option.value; title.append(name, id);
    const facts = document.createElement('dl');
    [['เขต', option.detail || 'ไม่ระบุ'], ['ประเภทห้อง', option.display?.room_type ?? 'ไม่ระบุ'], ['คืนขั้นต่ำเดิม', option.display?.minimum_nights ?? 'ไม่ระบุ'], ['ราคา', option.display?.price ?? 'ไม่ระบุ']]
      .forEach(([label, value]) => { const dt = document.createElement('dt'); dt.textContent = label; const dd = document.createElement('dd'); dd.textContent = String(value); facts.append(dt, dd); });
    const actions = document.createElement('div'); actions.className = 'listing-actions';
    const use = document.createElement('button'); use.type = 'button'; use.className = 'button button-primary'; use.textContent = 'ใช้ที่พักนี้';
    use.addEventListener('click', () => { setMappedListing(option); status.textContent = `เลือก listing_id ${option.value} แล้ว`; });
    const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'button button-quiet'; copy.textContent = 'คัดลอก listing_id';
    copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(option.value); status.textContent = `คัดลอก ${option.value} แล้ว`; } catch { status.textContent = `กรุณาคัดลอกรหัส ${option.value}`; } });
    actions.append(use, copy); detail.append(title, facts, actions);
  }

  function showResults(query = '') {
    const needle = query.trim().toLocaleLowerCase('th-TH');
    const matches = field.lookupOptions.filter((option) => `${option.value} ${option.label} ${option.detail}`.toLocaleLowerCase('th-TH').includes(needle)).slice(0, 8);
    results.replaceChildren();
    matches.forEach((option) => { const button = document.createElement('button'); button.type = 'button'; button.className = 'listing-result'; const strong = document.createElement('strong'); strong.textContent = option.label; const span = document.createElement('span'); span.textContent = `${option.detail || 'ไม่ระบุเขต'} · ${option.value}`; button.append(strong, span); button.addEventListener('click', () => showDetail(option)); results.append(button); });
    if (!matches.length) results.textContent = 'ไม่พบที่พักที่ตรงกับคำค้น';
  }
  search.addEventListener('input', () => showResults(search.value)); showResults(); box.append(heading, search, results, detail, status); return box;
}

function renderForm() {
  elements.formFields.replaceChildren();
  const listingField = state.dataset.fields.find((field) => field.key === 'listing_id' && field.lookupOptions?.length);
  if (listingField) elements.formFields.append(renderListingPicker(listingField));
  state.dataset.fields.forEach((field) => {
    if (field.hidden) return;
    const wrapper = document.createElement('div'); wrapper.className = 'field';
    const label = document.createElement('label'); label.htmlFor = `field-${field.key}`; label.textContent = field.label || field.key;
    if (field.required) { const required = document.createElement('span'); required.className = 'required'; required.textContent = '*'; label.append(required); }
    const key = document.createElement('code'); key.className = 'field-key'; key.textContent = field.key; label.append(key);
    const input = createInput(field);
    const help = document.createElement('p'); help.className = 'field-help'; help.textContent = field.description || `ชนิดข้อมูล: ${field.type}`;
    const error = document.createElement('p'); error.className = 'field-error'; error.id = `error-${field.key}`; error.setAttribute('aria-live', 'polite');
    input.setAttribute('aria-describedby', error.id); wrapper.append(label, input, help, error); elements.formFields.append(wrapper);
  });
  const neighbourhoodInput = elements.dataForm.elements.Neighbourhood;
  const roomTypeInput = elements.dataForm.elements.Room_Type;
  if (neighbourhoodInput && roomTypeInput && state.dataset.validPairs?.length) {
    const allRoomTypes = [...new Set(state.dataset.validPairs.map((pair) => pair.room_type))].sort();
    const filterRoomTypes = () => {
      const allowed = neighbourhoodInput.value
        ? [...new Set(state.dataset.validPairs.filter((pair) => pair.neighbourhood === neighbourhoodInput.value).map((pair) => pair.room_type))].sort()
        : allRoomTypes;
      const previous = roomTypeInput.value;
      roomTypeInput.replaceChildren(new Option('เลือกค่า', ''));
      allowed.forEach((option) => roomTypeInput.append(new Option(option, option)));
      roomTypeInput.value = allowed.includes(previous) ? previous : '';
    };
    neighbourhoodInput.addEventListener('change', filterRoomTypes);
    filterRoomTypes();
  }
  if (listingField) elements.dataForm.elements.listing_id.addEventListener('change', () => { const option = listingField.lookupOptions.find((item) => item.value === elements.dataForm.elements.listing_id.value.trim()); if (option) setMappedListing(option); });
}

function collectValues() {
  const values = {};
  state.dataset.fields.forEach((field) => { values[field.key] = field.hidden ? '' : elements.dataForm.elements[field.key].value; });
  state.values = values; return values;
}

function validateClient(values) {
  const errors = {};
  state.dataset.fields.forEach((field) => {
    const value = values[field.key]; if (field.hidden) return;
    if (field.required && value === '') errors[field.key] = 'จำเป็นต้องกรอก';
    if (value !== '' && ['integer', 'number', 'percentage'].includes(field.type)) {
      const number = Number(value);
      if (!Number.isFinite(number)) errors[field.key] = 'ต้องเป็นตัวเลข';
      else if (field.type === 'integer' && !Number.isInteger(number)) errors[field.key] = 'ต้องเป็นจำนวนเต็ม';
      else if (field.type === 'percentage' && (number < 1 || number > 100)) errors[field.key] = 'กรุณากรอก 1–100%';
      else if (field.min != null && number < field.min) errors[field.key] = `ต้องไม่น้อยกว่า ${field.min}`;
    }
    if (value !== '' && field.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) errors[field.key] = 'กรุณาระบุวันที่ให้ถูกต้อง';
    if (value !== '' && field.type === 'datetime' && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) errors[field.key] = 'กรุณาระบุวันและเวลาให้ถูกต้อง';
    if (value !== '' && field.lookupOptions?.length && !field.lookupOptions.some((option) => option.value === value)) errors[field.key] = 'กรุณาเลือกที่พักจากรายการ';
  });
  if (values.Neighbourhood && values.Room_Type && state.dataset.validPairs?.length
    && !state.dataset.validPairs.some((pair) => pair.neighbourhood === values.Neighbourhood && pair.room_type === values.Room_Type)) {
    errors.Room_Type = 'ประเภทห้องนี้ไม่มีใน tblLookup สำหรับเขตที่เลือก';
  }
  if (values.minimum_nights && values.maximum_nights && Number(values.minimum_nights) > Number(values.maximum_nights)) errors.maximum_nights = 'จำนวนคืนสูงสุดต้องไม่น้อยกว่าจำนวนคืนขั้นต่ำ';
  return errors;
}

function showFieldErrors(errors) {
  state.dataset.fields.forEach((field) => { if (field.hidden) return; const input = elements.dataForm.elements[field.key]; const error = document.querySelector(`#error-${CSS.escape(field.key)}`); const message = errors[field.key] || ''; error.textContent = message; input.setAttribute('aria-invalid', message ? 'true' : 'false'); });
  const first = Object.keys(errors)[0]; if (first && elements.dataForm.elements[first]) elements.dataForm.elements[first].focus();
}

function renderReview() {
  elements.reviewList.replaceChildren();
  state.dataset.fields.forEach((field) => { if (field.hidden) return; const value = state.values[field.key]; const dt = document.createElement('dt'); dt.textContent = field.label || field.key; const dd = document.createElement('dd'); dd.textContent = value === '' ? 'เว้นว่าง' : field.type === 'percentage' ? `${formatNumber(value, 2)}%` : value; dd.classList.toggle('is-empty', value === ''); elements.reviewList.append(dt, dd); });
  elements.requestId.textContent = state.requestId; elements.submissionResult.hidden = true; elements.newEntryButton.hidden = true; elements.submitButton.hidden = false; elements.editButton.hidden = false;
}

function formatCalculatedValue(field, value) {
  if (value == null || value === '') return 'ไม่ระบุ';
  if (field.format === 'percentage') return formatPercent(value, 2);
  if (field.format === 'number') return formatNumber(value, 2);
  if (field.format === 'decimal') return formatNumber(value, 2);
  return String(value);
}

function renderSubmissionResult(result) {
  elements.submissionResult.replaceChildren();
  const message = document.createElement('strong'); message.textContent = result.message;
  elements.submissionResult.append(message);
  if (result.excel_reference) {
    const reference = document.createElement('p'); reference.textContent = `ตำแหน่ง: ${result.excel_reference}`; elements.submissionResult.append(reference);
  }
  const values = result.calculated_values || {};
  if (state.dataset.resultFields?.length && Object.keys(values).length) {
    const heading = document.createElement('h3'); heading.textContent = 'ผลคำนวณจาก Excel (K–U)'; elements.submissionResult.append(heading);
    const grid = document.createElement('dl'); grid.className = 'calculation-results';
    state.dataset.resultFields.forEach((field) => {
      const dt = document.createElement('dt'); dt.textContent = field.label;
      const dd = document.createElement('dd'); dd.textContent = formatCalculatedValue(field, values[field.key]);
      grid.append(dt, dd);
    });
    elements.submissionResult.append(grid);
  }
}

async function submitData() {
  elements.submitButton.disabled = true; elements.submitButton.textContent = 'กำลังส่ง…'; elements.submissionResult.hidden = true;
  const data = Object.fromEntries(state.dataset.fields.map((field) => {
    const value = state.values[field.key];
    if (value === '') return [field.key, null];
    if (field.type === 'percentage') return [field.key, Number(value) / 100];
    if (['integer', 'number'].includes(field.type)) return [field.key, Number(value)];
    return [field.key, value];
  }));
  try {
    const result = await fetchJson('/api/submissions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sheet_name: state.dataset.name, request_id: state.requestId, data }) });
    state.sent = true; state.analyticsLoaded = false; renderSubmissionResult(result); elements.submissionResult.className = `submission-result ${result.excel_write_status === 'confirmed' ? 'success' : 'warning'}`; elements.submissionResult.hidden = false; elements.submitButton.hidden = true; elements.editButton.hidden = true; elements.newEntryButton.hidden = false;
  } catch (error) { elements.submissionResult.textContent = `${error.message} ค่าที่กรอกและ request_id เดิมยังคงอยู่`; elements.submissionResult.className = 'submission-result error'; elements.submissionResult.hidden = false; }
  finally { elements.submitButton.disabled = false; elements.submitButton.textContent = 'ส่งข้อมูล'; }
}

elements.dataForm.addEventListener('submit', (event) => { event.preventDefault(); clearGlobalError(); const values = collectValues(); const errors = validateClient(values); showFieldErrors(errors); if (Object.keys(errors).length) return; if (!state.requestId) state.requestId = createRequestId(); renderReview(); showManagePanel('review'); });
elements.editButton.addEventListener('click', () => showManagePanel('form'));
elements.submitButton.addEventListener('click', submitData);
elements.newEntryButton.addEventListener('click', () => selectDataset(state.dataset));

async function initialise() {
  try {
    const health = await fetchJson('/api/health');
    state.mode = health.mode;
    if (elements.managementSteps) elements.managementSteps.hidden = health.mode === 'read_only_excel';
  } catch (error) { showGlobalError(error.message); }
  const requestedView = location.hash.slice(1);
  const initialView = allowedViews.includes(requestedView) ? requestedView : 'explore';
  switchView(initialView, false);
  try {
    const [geojson] = await Promise.all([fetchJson('/api/catalog/neighbourhoods.geojson'), loadListings(1)]);
    state.geojson = geojson; drawMap();
  } catch (error) { showGlobalError(error.message); }
}

initialise();
