# StayHub — เว็บไซต์สำรวจข้อมูลที่พักในกรุงเทพฯ

เว็บแอปภาษาไทยที่รันบน localhost ด้วย Node.js + Express ระบบอ่านผลวิเคราะห์และเขียนแถวใหม่ลง `StayHub_final.xlsx` โดยตรงในตาราง `tblSubmissions` ชีต `user_submissions`

## ฟังก์ชันปัจจุบัน

- สำรวจที่พักด้วยชื่อ เขต `listing_id` ประเภทห้อง ช่วงราคา จำนวนคืนขั้นต่ำ และจำนวนรีวิว
- แผนที่ตำแหน่งที่พักจากพิกัดใน `listings.csv` โดยไม่มีเส้นขอบเขตเขต
- รายละเอียดที่พัก ค่า availability 365 วัน และรายการผู้รีวิวแบบปิดบังชื่อ
- รีวิวเก่าจะแสดงคะแนน 3–5 ดาว ข้อความ และเวลาแบบ mock ที่สร้างอย่างคงที่ใน Frontend พร้อมป้าย `ข้อมูลจำลอง`; ค่าเหล่านี้ไม่ถูกส่งเข้า API, Excel หรือการวิเคราะห์
- ภาพประกอบที่พัก 6 ประเภท จับคู่จากชื่อและ `room_type` และเก็บเป็นไฟล์ local ใน `public/images/listings/`
- โปรไฟล์สาธิต 2 บัญชี พร้อมเมนูและหน้าจอตามบทบาท
  - ผู้เข้าพัก: หน้าหลัก, Dashboard ภาพรวม และเขียนรีวิวที่พัก
  - เจ้าของที่พัก: หน้าหลัก, Dashboard วิเคราะห์ และเพิ่มข้อมูล `user_submissions`
- รีวิวที่ผู้เข้าพักเขียนเก็บใน `data/local-reviews.json` แยกจาก Excel
- ภาพรวมจำนวนที่พัก เขต ราคามัธยฐาน รีวิว และสัดส่วนวันที่เปิดให้จอง
- แดชบอร์ดจากผลลัพธ์ที่บันทึกไว้ใน `StayHub_final.xlsx`: Forecasting, Model Accuracy, Break-even, Sensitivity, Goal Seek และ Integrity
- ฟอร์มประเมินราคารับ 9 คอลัมน์ A–I และปล่อยให้ Excel คำนวณ `Lookup_ID` กับผลลัพธ์ K–U
- หน้าตรวจทานก่อนบันทึก แสดงข้อผิดพลาดใกล้ช่องกรอก และแสดงผลคำนวณหลัง Excel บันทึกสำเร็จ

หน้าเปรียบเทียบที่พักและการเพิ่ม master data ยังไม่อยู่ในเวอร์ชันนี้

## แหล่งข้อมูล

ชุดข้อมูลที่พักต้นทางดาวน์โหลดจาก [Inside Airbnb — Get the Data](https://insideairbnb.com/get-the-data/)

| ไฟล์ | การใช้งาน |
| --- | --- |
| `file/listings.csv` | รายการที่พัก ตัวกรอง พิกัด และข้อมูลสรุป |
| `file/calendar_monthly.csv` | สรุปสถานะเปิดให้จองรายเดือนสำหรับกราฟภาพรวม |
| `file/reviews.csv` | สำเนา `listing_id,date` จากชีต `web_reviews` สำหรับวันที่รีวิวและแนวโน้มรายเดือน |
| `file/neighbourhoods.csv` | รายชื่อเขตที่ใช้ในกระบวนการข้อมูล |
| `file/lookup_phase1.csv` | ตารางสรุป neighbourhood และ room type สำหรับการวิเคราะห์ |
| `file/StayHub_final.xlsx` | Workbook หลักและผลวิเคราะห์สำหรับหน้าแดชบอร์ด |
| `data/local-reviews.json` | รีวิวที่เขียนผ่านเว็บไซต์ สร้างเมื่อมีรีวิวแรกและไม่แก้ Workbook |

ระบบสร้างดัชนีรีวิวไว้ที่ `.cache/stayhub-activity-index.json` เมื่อเปิดรายละเอียดหรือภาพรวมครั้งแรก ดัชนีจะสร้างใหม่อัตโนมัติเมื่อ `reviews.csv` เปลี่ยน และโฟลเดอร์ `.cache/` ไม่ถูกนำเข้า Git

หากต้องสร้าง `reviews.csv` คืนจาก Workbook โดยไม่แก้ Workbook ให้รัน `node scripts/exportReviewsCsv.js` สคริปต์จะอ่านเฉพาะชีต `web_reviews` และรักษาวันที่เป็น `YYYY-MM-DD`

## ติดตั้งและรัน

ต้องใช้ Node.js 20 ขึ้นไป

```powershell
pnpm install
Copy-Item .env.example .env
pnpm start
```

เปิด `http://localhost:3000`

ตัวอย่าง `.env`:

```env
PORT=3000
EXCEL_SCHEMA_PATH=./file/StayHub_final.xlsx
ANALYTICS_WORKBOOK_PATH=./file/StayHub_final.xlsx
READ_ONLY_MODE=false
SUBMISSION_LEDGER_PATH=./data/submission-ledger.json
LOCAL_REVIEWS_PATH=./data/local-reviews.json
EXCEL_WRITE_TIMEOUT_MS=300000
```

โหมดนี้ไม่ใช้ Make หรือ Webhook แต่ใช้ Microsoft Excel COM ในเครื่อง จึงต้องติดตั้ง Microsoft Excel และปิด Workbook ก่อนกดบันทึก

บัญชีทั้งสองเป็นบัญชีสาธิตสำหรับเปลี่ยนมุมมองบน localhost ไม่ใช่ระบบยืนยันตัวตนสำหรับใช้งานบนอินเทอร์เน็ต

## API

| Method | Path | หน้าที่ |
| --- | --- | --- |
| GET | `/api/health` | ตรวจโหมด Excel ในเครื่องและชื่อ Workbook |
| GET | `/api/catalog/listings` | ค้นหา กรอง และแบ่งหน้ารายการที่พัก |
| GET | `/api/catalog/listings/:id` | รายละเอียดที่พัก |
| GET | `/api/catalog/listings/:id/activity` | วันที่มีรีวิวของที่พักและคำอธิบายข้อจำกัดปฏิทิน |
| GET | `/api/catalog/overview` | ข้อมูลสรุปสำหรับหน้าภาพรวม |
| GET | `/api/catalog/neighbourhoods.geojson` | คืน FeatureCollection ว่างเมื่อไม่มีไฟล์ขอบเขตเขต |
| GET | `/api/analytics` | ผลวิเคราะห์ที่บันทึกไว้ใน StayHub final |
| GET | `/api/schema` | โครงสร้าง 9 ช่องกรอก ตัวเลือกจาก `tblLookup` และชื่อผลลัพธ์ K–U |
| POST | `/api/submissions` | ตรวจข้อมูล เพิ่มแถวใน `tblSubmissions` และคืนผลคำนวณ K–U |
| GET | `/api/reviews?listing_id=...` | อ่านรีวิวที่ผู้ใช้เขียนผ่านเว็บไซต์ |
| POST | `/api/reviews` | ตรวจและบันทึกรีวิวลง JSON ในเครื่องโดยไม่แก้ Excel |

Express ให้บริการ static เฉพาะ `public/` จึงไม่เปิดไฟล์ CSV หรือ Excel ผ่าน static web server

## การบันทึกลง Excel

- ผู้ใช้กรอก `Submission_ID`, `Timestamp`, `Neighbourhood`, `Room_Type`, `Proposed_Price`, `Monthly_FC`, `PerNight_VC`, `Target_Profit`, `Target_Occupancy`
- `Submission_ID` และ `Timestamp` มีค่าตั้งต้นอัตโนมัติ แต่ผู้ใช้แก้ได้
- Backend เขียนเฉพาะ A–I ลง `tblSubmissions`; `Lookup_ID` ใน J และสูตร K–U ยังเป็นสูตรของ Workbook
- Backend รอให้ Excel คำนวณเสร็จแล้วส่งค่า K–U กลับไปแสดงบนเว็บ โดยไม่แสดง `Lookup_ID`
- `request_id` และ ledger ป้องกันการเพิ่มแถวซ้ำจากการกดส่งซ้ำ
- ระบบไม่เปลี่ยนโครงสร้าง Sheet, Table หรือสูตรเดิม; การส่งแต่ละรายการจะเพิ่มแถวใน `StayHub_final.xlsx`

รันทดสอบ:

```powershell
pnpm test
```

## ข้อจำกัด

- เว็บ localhost ใช้งานได้เฉพาะเครื่องที่รัน หรืออุปกรณ์ในเครือข่ายที่เปิดพอร์ตให้เข้าถึง ไม่มี HTTPS หรือระบบล็อกอินในตัว
- การสลับบัญชีเป็นการจำลองบทบาทใน Frontend ไม่ใช่ระบบ Login/Authorization ที่ปลอดภัยสำหรับ Production
- ไม่มี `calendar.csv` จึงไม่แสดงปฏิทินรายวันของแต่ละ listing หน้า Overview ใช้ `calendar_monthly.csv` แทน
- ไม่มี `neighbourhoods.geojson` จึงแสดงเฉพาะจุดพิกัดที่พักโดยไม่มีเส้นขอบเขตเขต
- หน้า Dashboard อ่านค่าที่ Workbook บันทึกไว้ครั้งล่าสุดและไม่สั่ง Refresh หรือ Recalculate
- ค่า `DataFolder` ภายใน Workbook เป็นส่วนของไฟล์ต้นฉบับ เว็บไซต์ไม่แก้ไขค่านี้
- ราคาจาก `listings` ไม่มีสกุลเงินระบุไว้ จึงแสดงเป็นตัวเลขโดยไม่เติมสัญลักษณ์สกุลเงิน
- `available=f` อาจหมายถึงเจ้าของปิดรับ ไม่ใช่หลักฐานว่ามีผู้เข้าพัก
- ข้อมูลตั้งต้นมีเพียงวันที่รีวิว ไม่มีชื่อ ข้อความ คะแนน หรือเวลา ค่าที่แสดงในรีวิวเก่าจึงเป็น mock สำหรับหน้าจอและไม่ถูกใช้ในการวิเคราะห์ ส่วนรีวิวที่เขียนใหม่เป็นข้อมูล local แยกจากชุดข้อมูลต้นฉบับ
- ภาพบนการ์ดเป็นภาพประกอบที่สร้างขึ้นตามประเภท ไม่ใช่ภาพจริงของ listing จึงมีป้ายกำกับบนรูปทุกใบ
