# คู่มือ deploy ขึ้น Cloudflare

> **สถานะ: โค้ดปัจจุบันยัง deploy ขึ้น Cloudflare ตรงๆ ไม่ได้** ไฟล์ `wrangler.jsonc`, Worker entry และ `schema.sql` ในคู่มือนี้ **ยังไม่มีในโปรเจกต์** คู่มือนี้อธิบายว่าต้องเปลี่ยนอะไรบ้าง ขั้นตอน deploy เมื่อเปลี่ยนเสร็จ และความเสี่ยงที่ควรรู้ก่อนตัดสินใจ

ถ้าต้องการแค่ให้ส่งอัตโนมัติทุกวันโดยไม่ต้องเปิด terminal ทิ้งไว้ ใช้ launchd / Task Scheduler ตาม[คู่มือรันบนเครื่อง](run-local.th.md#9-ตั้งเวลาส่งทุกวัน) จะง่ายและเสี่ยงน้อยกว่ามาก

## 1. ทำไมรันบน Cloudflare ตรงๆ ไม่ได้

Cloudflare Workers ไม่มี filesystem ถาวร รันโปรแกรมนอก Worker ไม่ได้ และไม่มีหน้าจอ แต่โปรเจกต์นี้ออกแบบให้รันบนเครื่องส่วนตัว:

| ส่วนประกอบ          | ตอนนี้ใช้                                            | บน Cloudflare ต้องเปลี่ยนเป็น                      |
| ------------------- | ---------------------------------------------------- | -------------------------------------------------- |
| Browser             | Playwright เปิด Chromium บนเครื่อง (`src/browser`)   | Browser Rendering ผ่าน `@cloudflare/playwright`    |
| Session ล็อกอิน     | โฟลเดอร์ `browser-profile` ถาวร                      | `storageState` (JSON cookie) เก็บใน KV             |
| ประวัติ / กันส่งซ้ำ | `node:sqlite` ไฟล์ `history.sqlite` (`src/database`) | D1 (SQLite ของ Cloudflare)                         |
| Lock กันรันซ้อน     | `proper-lockfile` บนดิสก์                            | ไม่จำเป็น (cron รันทีละรอบ) หรือใช้ Durable Object |
| ตั้งเวลา            | `node-cron` (`src/scheduler`)                        | Cron Trigger ของ Worker (เวลา UTC)                 |
| Config              | `config.json` + `.env` อ่านจากดิสก์                  | import JSON ตอน build หรือเก็บใน KV                |
| ล็อกอินครั้งแรก     | เปิดหน้าต่างให้ล็อกอินเอง (`src/auth`)               | ล็อกอินบนเครื่องตัวเอง แล้วอัปโหลด session ขึ้น KV |

ส่วนที่ใช้ซ้ำได้เกือบทั้งหมด: `src/tiktok/adapter.ts` (ใช้ Playwright API แบบเดียวกัน), `src/tiktok/runner.ts`, `src/config` (schema), `src/utils`

## 2. ความเสี่ยงที่ต้องรู้ก่อน

- **โดน TikTok ตรวจจับง่ายขึ้นมาก** Browser Rendering รันจาก IP ของ data center ไม่ใช่ IP บ้าน และ session ถูกย้ายจากเครื่องที่ล็อกอินไปใช้ที่อื่น มีโอกาสสูงที่จะเจอ `SECURITY_CHALLENGE` หรือ session หลุด (`AUTH_REQUIRED`) บ่อย โปรเจกต์นี้จะหยุดทันทีเมื่อเจอ ไม่มีการหลบเลี่ยง
- **Session ออกจากเครื่องคุณ** cookie ใน KV เทียบเท่ารหัสผ่าน TikTok ใครเข้าบัญชี Cloudflare ได้ก็เข้า TikTok ได้ ควรเปิด 2FA บัญชี Cloudflare
- **ข้อจำกัดเวลา** Cron Trigger รันได้นานสุดประมาณ 15 นาทีต่อรอบ ด้วย `minIntervalSeconds: 60` จะส่งได้ราว 10–12 คนต่อรอบ
- **ค่าใช้จ่าย** แผน Workers Free ใช้ Browser Rendering ได้ 10 นาที/วัน (พอสำหรับผู้รับไม่กี่คน) เกินนั้นต้องใช้ Workers Paid ดูราคาล่าสุดที่ [Cloudflare pricing](https://developers.cloudflare.com/browser-run/pricing/)
- **ทดสอบไม่ได้แบบเห็นหน้าจอ** headless อย่างเดียว ต้องปรับ selector บนเครื่องตัวเองให้ผ่าน dry-run ก่อนเสมอ

## 3. สถาปัตยกรรมที่แนะนำ

```text
 เครื่องคุณ                                 Cloudflare
┌──────────────────────┐        ┌──────────────────────────────────────┐
│ bun run login        │        │  Cron Trigger (ทุกวัน 13:00 UTC)        │
│ bun run export-session ─────▶ │        │                             │
│   (storageState.json)│ wrangler│        ▼                             │
└──────────────────────┘  kv put │  Worker ── runMessages() ──▶ D1       │
                                │    │                    (history)    │
                                │    ├─▶ KV: SESSION (storageState)    │
                                │    └─▶ Browser Rendering ──▶ TikTok   │
                                └──────────────────────────────────────┘
```

## 4. สิ่งที่ต้องแก้ในโค้ดก่อน deploy

- [ ] **เพิ่มคำสั่ง `export-session`** ใน `src/cli/index.ts` เปิด persistent profile เดิม แล้วบันทึก `context.storageState()` เป็นไฟล์ JSON (บนเครื่องตัวเอง)
- [ ] **แยก interface ของ History** ออกจาก `node:sqlite` แล้วทำเวอร์ชัน D1 ที่ทำงานเหมือนเดิม โดยเฉพาะ `reserve()` ต้องใช้ `INSERT OR IGNORE` แล้วเช็ค `meta.changes === 1` เพื่อให้กันส่งซ้ำได้จริง D1 เป็น async ทั้งหมด ดังนั้น `runner.ts` ต้องเปลี่ยนเป็น `await` ทุกจุดที่เรียก history
- [ ] **ทำ `createMessenger` เวอร์ชัน Cloudflare** ใช้ `launch(env.BROWSER, { keep_alive: 600000 })` จาก `@cloudflare/playwright` แล้ว `browser.newContext({ storageState })` จาก KV แทน `launchPersistentContext`
- [ ] **สร้าง `src/worker.ts`** มี handler `scheduled()` ที่โหลด config, เรียก `runMessages()` และ `fetch()` สำหรับดูสถานะ (ป้องกันด้วย token)
- [ ] **ตัด dependency ที่รันบน Worker ไม่ได้** ออกจาก path ของ Worker: `playwright`, `node:sqlite`, `proper-lockfile`, `node-cron`, `dotenv` (ส่วน `pino` เปลี่ยนเป็น `console` ได้ เพราะ Worker เก็บ log ให้)
- [ ] **ทดสอบ** ให้ `bun run check` ยังผ่าน และเพิ่ม test สำหรับ History เวอร์ชัน D1

## 5. ขั้นตอน deploy (หลังแก้โค้ดตามข้อ 4 แล้ว)

### 5.1 เตรียมบนเครื่องตัวเอง

ทำตาม[คู่มือรันบนเครื่อง](run-local.th.md) ขั้นตอน 1–7 ให้ครบ คือล็อกอินได้ ปรับ selector แล้ว และ `bun run test:send` ผ่าน **อย่าข้ามขั้นนี้** เพราะบน Cloudflare ดูหน้าจอไม่ได้

### 5.2 ติดตั้ง Wrangler และล็อกอิน Cloudflare

```sh
bun add -d wrangler
bun add @cloudflare/playwright
bunx wrangler login
```

### 5.3 สร้าง D1 และ KV

```sh
bunx wrangler d1 create tiktok-streak-keeper
bunx wrangler kv namespace create SESSION
```

จด `database_id` และ KV `id` ที่ได้ไว้ใส่ในขั้นถัดไป

### 5.4 สร้าง `wrangler.jsonc`

```jsonc
{
  "name": "tiktok-streak-keeper",
  "main": "src/worker.ts",
  "compatibility_date": "2025-09-15",
  "compatibility_flags": ["nodejs_compat"],
  "browser": { "binding": "BROWSER" },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "tiktok-streak-keeper",
      "database_id": "ใส่ database_id จากข้อ 5.3",
    },
  ],
  "kv_namespaces": [{ "binding": "SESSION", "id": "ใส่ KV id จากข้อ 5.3" }],
  "triggers": {
    // Cron ของ Cloudflare เป็นเวลา UTC: 13:00 UTC = 20:00 Asia/Bangkok
    "crons": ["0 13 * * *"],
  },
  "observability": { "enabled": true },
}
```

ถ้าเปลี่ยน `schedule` ใน `config.json` ต้องแปลงเป็น UTC แล้วแก้ `crons` ด้วย (บน Cloudflare ค่า `schedule` ไม่ได้ถูกใช้ตั้งเวลา)

### 5.5 สร้างตาราง D1

สร้าง `schema.sql` (โครงสร้างเดียวกับ `src/database/index.ts`):

```sql
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS deliveries (
  recipient TEXT NOT NULL, day TEXT NOT NULL, message TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'sent', 'uncertain')),
  timestamp TEXT NOT NULL, PRIMARY KEY (recipient, day)
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, recipient TEXT NOT NULL, day TEXT NOT NULL,
  message TEXT NOT NULL, status TEXT NOT NULL, timestamp TEXT NOT NULL, code TEXT
);
INSERT OR IGNORE INTO settings VALUES ('timezone', 'Asia/Bangkok');
```

```sh
bunx wrangler d1 execute tiktok-streak-keeper --remote --file=schema.sql
```

ประวัติบนเครื่องกับบน D1 แยกกัน ถ้าวันนี้ส่งจากเครื่องไปแล้ว Cloudflare จะไม่รู้ ห้ามรันทั้งสองที่พร้อมกัน

### 5.6 อัปโหลด session

```sh
bun run login            # ถ้า session หมดอายุ
bun run export-session   # ได้ไฟล์ storageState.json (คำสั่งจากข้อ 4)
bunx wrangler kv key put --binding=SESSION --remote storageState --path=storageState.json
rm storageState.json     # ลบทิ้งทันที ห้าม commit
```

ทำขั้นนี้ซ้ำทุกครั้งที่เจอ `AUTH_REQUIRED`

### 5.7 ตั้ง secret (ถ้ามี endpoint ดูสถานะ)

```sh
bunx wrangler secret put STATUS_TOKEN
```

### 5.8 ทดสอบบนเครื่องก่อน deploy

ให้ `config.json` ยังเป็น `dryRun: true`

```sh
bunx wrangler dev --remote --test-scheduled
# อีก terminal:
curl "http://localhost:8787/__scheduled?cron=0+13+*+*+*"
```

`--remote` จำเป็นเพราะ Browser Rendering ต้องรันบน Cloudflare ดู log ว่าเปิดแชตและตรวจ username ผ่าน

### 5.9 Deploy

```sh
bunx wrangler deploy
```

เริ่มด้วย `dryRun: true` ปล่อยให้ cron รัน 1–2 วันก่อน ดูผลด้วย:

```sh
bunx wrangler tail
bunx wrangler d1 execute tiktok-streak-keeper --remote \
  --command "SELECT recipient, day, status, timestamp FROM deliveries ORDER BY timestamp DESC LIMIT 20"
```

เมื่อมั่นใจแล้วจึงเปิดโหมดจริง (3 ค่าเดิม: `dryRun: false`, `liveSendingEnabled: true`, `ui.verified: true`) แล้ว `bunx wrangler deploy` ใหม่

### 5.10 หยุดใช้งาน

- หยุดชั่วคราว: ลบ `crons` ออกจาก `wrangler.jsonc` แล้ว deploy ใหม่ หรือปิด trigger ใน Cloudflare Dashboard
- ลบ session ทันที: `bunx wrangler kv key delete --binding=SESSION --remote storageState`
- ลบทั้งหมด: `bunx wrangler delete` แล้วลบ D1 และ KV ใน Dashboard

## 6. ทางเลือกอื่นบน Cloudflare: Containers

Cloudflare Containers (ต้องใช้ Workers Paid) รัน Docker image ที่มี Bun + Chromium ได้ ใช้โค้ดเดิมได้มากกว่า แต่ดิสก์ของ container **ไม่ถาวร** ต้องย้าย `history.sqlite` และ session ไปเก็บที่อื่น (D1 / R2) อยู่ดี และยังเจอปัญหา IP data center เหมือนกัน จึงไม่ได้ง่ายกว่าแนวทางในข้อ 3 มากนัก

## สรุป

| ทางเลือก                               | งานที่ต้องทำ              | ความเสี่ยงโดนตรวจจับ | แนะนำเมื่อ                             |
| -------------------------------------- | ------------------------- | -------------------- | -------------------------------------- |
| เครื่องตัวเอง + launchd/Task Scheduler | ไม่ต้องแก้โค้ด            | ต่ำ                  | ใช้ส่วนตัว เครื่องเปิดตอนเย็นเป็นประจำ |
| Cloudflare Worker + Browser Rendering  | แก้โค้ดตามข้อ 4           | สูง                  | ไม่มีเครื่องที่เปิดได้ประจำเลย         |
| Cloudflare Containers                  | Dockerfile + ย้าย storage | สูง                  | ต้องการใช้โค้ดเดิมให้มากที่สุดบน cloud |
