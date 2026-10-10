# คู่มือรันบนเครื่องตัวเอง (macOS / Windows / Linux)

คู่มือนี้พาตั้งแต่ติดตั้งจนตั้งเวลาส่งข้อความอัตโนมัติทุกวัน รายละเอียดเชิงลึกของแต่ละหัวข้ออยู่ใน [README.md](../README.md)

> **ก่อนเริ่ม:** โปรเจกต์นี้ยังไม่ได้ทดสอบส่งข้อความกับ TikTok จริง selector ใน `config.example.json` เป็นแค่ตัวอย่าง ต้องปรับให้ตรงกับหน้าจอบัญชีของคุณเอง (ขั้นตอนที่ 5) และการส่งข้อความไม่ได้รับประกันว่า streak จะไม่หลุด

## สรุปขั้นตอน

| #   | ขั้นตอน                       | คำสั่ง                                                        |
| --- | ----------------------------- | ------------------------------------------------------------- |
| 1   | ติดตั้ง Bun                   | `curl -fsSL https://bun.sh/install \| bash`                   |
| 2   | ติดตั้ง dependency + Chromium | `bun install --frozen-lockfile` → `bun run browser:install`   |
| 3   | สร้างไฟล์ config              | `cp config.example.json config.json` / `cp .env.example .env` |
| 4   | ล็อกอิน TikTok (ทำเอง)        | `bun run login`                                               |
| 5   | ปรับ selector ให้ตรงหน้าจอ    | แก้ `ui` ใน `config.json`                                     |
| 6   | หาแชตและเพิ่มผู้รับ           | `bun run chats`                                               |
| 7   | ทดสอบแบบไม่ส่งจริง (dry-run)  | `bun run test:send`                                           |
| 8   | เปิดโหมดส่งจริง               | แก้ 3 ค่าใน `config.json` → `bun run send`                    |
| 9   | ตั้งเวลาส่งทุกวัน             | `bun run start` หรือ launchd / Task Scheduler                 |

---

## 1. ติดตั้ง Bun

ต้องใช้ Bun **1.4.2 ขึ้นไป** ไม่ต้องติดตั้ง Node.js หรือ npm

```sh
# macOS / Linux
curl -fsSL https://bun.sh/install | bash

# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"
```

เปิด terminal ใหม่แล้วตรวจเวอร์ชัน:

```sh
bun --version   # ต้องได้ 1.4.2 หรือใหม่กว่า
```

## 2. ติดตั้ง dependency และ Chromium

รันทุกคำสั่งจาก root ของโปรเจกต์ (โฟลเดอร์ที่มี `package.json`)

```sh
bun install --frozen-lockfile
bun run browser:install
```

บน Linux ถ้า Chromium เปิดไม่ขึ้น ให้ติดตั้ง package ของระบบเพิ่ม:

```sh
bun --bun playwright install --with-deps chromium
```

ตรวจว่าทุกอย่างพร้อม (ไม่มีการเชื่อมต่อ TikTok จริง):

```sh
bun run check
```

## 3. สร้างไฟล์ config

```sh
# macOS / Linux
cp config.example.json config.json
cp .env.example .env
```

```powershell
# Windows PowerShell
Copy-Item config.example.json config.json
Copy-Item .env.example .env
```

แก้ `DATA_DIR` ใน `.env` ให้ชี้ไปที่โฟลเดอร์ส่วนตัว **นอก** โฟลเดอร์ที่ sync ขึ้น cloud (iCloud Drive, OneDrive, Dropbox) เพราะในนี้จะมี browser profile ที่ล็อกอิน TikTok อยู่ และประวัติข้อความ

```sh
# macOS
DATA_DIR=/Users/YOU/Library/Application Support/tiktok-streak-keeper

# Linux
DATA_DIR=/home/YOU/.local/share/tiktok-streak-keeper

# Windows
DATA_DIR=C:/Users/YOU/AppData/Local/tiktok-streak-keeper
```

ถ้าไม่แก้ ค่าเริ่มต้นคือ `./data` ในโปรเจกต์ (git ignore ไว้แล้ว ใช้ได้ แต่ระวังถ้าโปรเจกต์อยู่ในโฟลเดอร์ที่ sync)

ค่าใน `config.json` ที่ควรรู้:

| ค่า                  | ค่าเริ่มต้น             | ความหมาย                                                    |
| -------------------- | ----------------------- | ----------------------------------------------------------- |
| `dryRun`             | `true`                  | `true` = ไม่ส่งจริง                                         |
| `liveSendingEnabled` | `false`                 | ต้องเป็น `true` ถึงจะส่งจริงได้                             |
| `timezone`           | `Asia/Bangkok`          | timezone แบบ IANA ห้ามเปลี่ยนหลังจากมีประวัติแล้ว           |
| `schedule`           | `20:00`                 | เวลาส่งทุกวัน (รูปแบบ `HH:mm`)                              |
| `headless`           | `false`                 | `false` = เห็นหน้าต่าง browser ตอนทำงาน                     |
| `messageTemplates`   | `["Hi {username}! 👋"]` | ข้อความที่สลับใช้รายวัน ใช้ได้แค่ `{username}` และ `{date}` |
| `minIntervalSeconds` | `60`                    | เว้นระยะระหว่างผู้รับแต่ละคน (ขั้นต่ำ 30)                   |
| `recipients`         | `[]`                    | รายชื่อผู้รับ (สูงสุด 20)                                   |

## 4. ล็อกอิน TikTok

```sh
bun run login
```

1. หน้าต่าง Chromium แยก (ไม่ใช่ Chrome ที่ใช้ประจำ) จะเปิดขึ้นที่หน้า login ของ TikTok
2. ล็อกอินด้วยตัวเอง ทำ verification ให้ครบ
3. เปิดหน้า inbox (ข้อความ)
4. กลับมาที่ terminal แล้วกด **Enter**

ถ้าขึ้น `Authenticated session saved locally.` แปลว่าสำเร็จ session จะเก็บไว้ที่ `DATA_DIR/browser-profile` เครื่องมือนี้ไม่เก็บรหัสผ่าน

ถ้าล็อกอินแล้วแต่ขึ้น `AUTH_REQUIRED` แปลว่า selector `ui.authenticated` ไม่ตรงกับหน้าจอของคุณ ให้ไปขั้นตอนที่ 5 แล้วกลับมาล็อกอินใหม่

## 5. ปรับ selector ให้ตรงหน้าจอ

ขั้นนี้สำคัญที่สุด เพราะหน้าจอ TikTok เปลี่ยนตามภาษา บัญชี และช่วงเวลา

1. คง `dryRun: true` และ `ui.verified: false` ไว้
2. เปิด browser ของโปรเจกต์ (เช่นระหว่าง `bun run login`) แล้วคลิกขวา → **Inspect** เพื่อดู HTML
3. หา selector ของแต่ละ element แล้วใส่ใน `config.json` ส่วน `ui`

| field                  | ต้องชี้ไปที่                                               |
| ---------------------- | ---------------------------------------------------------- |
| `authenticated`        | element ที่มีเฉพาะตอนล็อกอินแล้ว (เช่นไอคอนโปรไฟล์)        |
| `loginRequired`        | ปุ่มหรือหน้าต่างที่บอกให้ล็อกอิน                           |
| `securityChallenge`    | CAPTCHA / หน้ายืนยันตัวตน / หน้าจำกัดการใช้งาน             |
| `conversationLinks`    | ลิงก์ `<a>` ของแต่ละแชตในรายการ inbox                      |
| `conversationRoot`     | กล่องแชตที่เปิดอยู่ ต้องมีแค่ 1 อัน                        |
| `recipientProfileLink` | ลิงก์ `/@username` ที่หัวแชต ต้องมีแค่ 1 อัน               |
| `composer`             | ช่องพิมพ์ข้อความ                                           |
| `sendButton`           | ปุ่มส่ง                                                    |
| `outgoingMessages`     | ข้อความ **ที่เราส่งออกเท่านั้น** (ห้ามรวมข้อความที่ได้รับ) |
| `sendFailure`          | สถานะส่งไม่สำเร็จ / โดน rate limit                         |

ทดสอบ selector ได้ใน DevTools Console: `document.querySelectorAll("SELECTOR").length` ควรได้ตามที่ตารางบอก (ส่วนใหญ่ต้องเป็น 1)

แก้ `config.json` แล้วรันคำสั่งใหม่ได้เลย ไม่ต้องแก้โค้ด

## 6. หาแชตและเพิ่มผู้รับ

```sh
bun run chats
```

จะแสดงรายการแชตที่อยู่บนหน้าจอพร้อมหมายเลข เลือกคนที่ต้องการ:

```sh
bun run chats --select 1 --username friend.username
```

คำสั่งนี้แค่พิมพ์ JSON ออกมา **ไม่ได้แก้ config ให้** ให้ตรวจว่า URL เปิดแชตของคนนั้นจริงและ username ที่หัวแชตตรง แล้วคัดลอกไปใส่ใน `recipients` ของ `config.json` โดยเปลี่ยน `approved` เป็น `true`:

```json
"recipients": [
  {
    "username": "friend.username",
    "conversationUrl": "https://www.tiktok.com/messages/...",
    "approved": true,
    "messageTemplate": "หวัดดี {username} 🔥"
  }
]
```

`messageTemplate` ไม่ใส่ก็ได้ (จะใช้ `messageTemplates` กลาง) แนะนำให้เริ่มจาก **ผู้รับ 1 คน** ก่อน

ถ้า `chats` ขึ้น `No stable conversation links found` แปลว่าหน้าจอของคุณไม่มีลิงก์แชตที่คงที่ เวอร์ชันนี้จะใช้กับบัญชีนั้นไม่ได้

## 7. ทดสอบแบบไม่ส่งจริง (dry-run)

```sh
bun run test:send
```

เปิดแชตของผู้รับทุกคน ตรวจ username และหน้าจอ แต่ **ไม่พิมพ์และไม่กดส่ง** (บังคับ dry-run เสมอ แม้ config จะเปิดโหมดจริงไว้)

ดูผลลัพธ์:

```sh
bun run status
```

ควรเห็นรายการสถานะ `dry-run` ถ้าเจอ error ให้ดู [การแก้ปัญหา](#การแก้ปัญหา)

## 8. เปิดโหมดส่งจริง

เมื่อ dry-run ผ่านแล้ว แก้ 3 ค่าใน `config.json` (แก้เฉพาะค่า ไม่ต้องลบ field อื่นใน `ui`):

```json
{
  "dryRun": false,
  "liveSendingEnabled": true,
  "ui": { "verified": true, "...": "selector อื่นเหมือนเดิม" }
}
```

ส่งทันทีหนึ่งรอบ:

```sh
bun run send
```

แต่ละคนจะได้ข้อความไม่เกิน **1 ครั้งต่อวัน** ถ้ารันซ้ำในวันเดียวกัน ระบบจะข้ามคนที่ส่งแล้ว ตรวจด้วย `bun run status` ว่าขึ้น `sent`

## 9. ตั้งเวลาส่งทุกวัน

### ทางเลือก A: เปิด terminal ทิ้งไว้

```sh
bun run start
```

จะส่งตามเวลาใน `schedule` (ค่าเริ่มต้น 20:00 ตาม `timezone`) ทุกวัน

- ต้องเปิด terminal และให้เครื่อง **ไม่หลับ** ตลอด ถ้าเครื่องหลับตอนถึงเวลา รอบนั้นจะข้ามไป (ไม่มีส่งย้อนหลัง)
- macOS กันเครื่องหลับได้ด้วย `caffeinate -i bun run start`
- หยุดด้วย `Ctrl+C`
- แก้ `config.json` แล้วต้องหยุดและเริ่มใหม่

### ทางเลือก B (แนะนำบน macOS): launchd สั่ง `send` ตามเวลา

launchd จะรันรอบที่พลาดไปให้ทันทีเมื่อเครื่องตื่น จึงไม่ต้องเปิด terminal ทิ้งไว้ และส่งซ้ำไม่ได้เพราะระบบกันไว้ 1 ครั้งต่อวัน

1. หา path ของ Bun และโปรเจกต์:

   ```sh
   which bun   # เช่น /Users/YOU/.bun/bin/bun
   pwd         # path ของโปรเจกต์
   ```

2. สร้างไฟล์ `~/Library/LaunchAgents/com.YOU.tiktok-streak-keeper.plist` (แทน `YOU` และ path ให้ตรงกับเครื่อง):

   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0">
   <dict>
     <key>Label</key>
     <string>com.YOU.tiktok-streak-keeper</string>
     <key>WorkingDirectory</key>
     <string>/Users/YOU/Desktop/github/tiktok-streak-keeper</string>
     <key>ProgramArguments</key>
     <array>
       <string>/Users/YOU/.bun/bin/bun</string>
       <string>src/cli/index.ts</string>
       <string>send</string>
     </array>
     <key>StartCalendarInterval</key>
     <dict>
       <key>Hour</key><integer>20</integer>
       <key>Minute</key><integer>0</integer>
     </dict>
     <key>StandardOutPath</key>
     <string>/Users/YOU/Library/Logs/tiktok-streak-keeper.log</string>
     <key>StandardErrorPath</key>
     <string>/Users/YOU/Library/Logs/tiktok-streak-keeper.log</string>
   </dict>
   </plist>
   ```

   เวลาใน `StartCalendarInterval` ใช้ timezone ของเครื่อง ไม่ใช่ `timezone` ใน config

3. โหลดและทดสอบ:

   ```sh
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.YOU.tiktok-streak-keeper.plist
   launchctl kickstart gui/$(id -u)/com.YOU.tiktok-streak-keeper   # สั่งรันทันทีเพื่อทดสอบ
   tail -f ~/Library/Logs/tiktok-streak-keeper.log
   ```

   ยกเลิก: `launchctl bootout gui/$(id -u)/com.YOU.tiktok-streak-keeper`

ห้ามใช้ทางเลือก A กับ B พร้อมกัน (จะชน lock และขึ้น `LOCKED`)

### Windows: Task Scheduler

สร้าง task ใหม่ ตั้ง trigger รายวันตามเวลาที่ต้องการ แล้วตั้ง action:

- **Program:** `C:\Users\YOU\.bun\bin\bun.exe`
- **Arguments:** `src/cli/index.ts send`
- **Start in:** path ของโปรเจกต์

เลือก "Run only when user is logged on" (ใช้ user เดียวกับตอน `login`) และติ๊ก "Run task as soon as possible after a scheduled start is missed"

### Linux

ใช้ cron หรือ systemd timer สั่ง `bun src/cli/index.ts send` จาก root ของโปรเจกต์ด้วย user เดียวกับที่ล็อกอิน ถ้าไม่มีหน้าจอ ตั้ง `headless: true` หลังจากล็อกอินบนเครื่องที่มีหน้าจอแล้ว (ไม่รับประกันว่า session จะใช้ได้)

---

## สถานะในประวัติ (`bun run status`)

| สถานะ       | ความหมาย                                                                 |
| ----------- | ------------------------------------------------------------------------ |
| `dry-run`   | แค่ทดสอบ ยังส่งจริงได้ในวันนั้น                                          |
| `failed`    | ล้มเหลวก่อนกดส่ง ดู error code แล้วรันใหม่ได้                            |
| `pending`   | จองไว้แล้วแต่โปรแกรมหยุดกลางคัน วันนั้นจะไม่ส่งซ้ำ                       |
| `sent`      | เห็นข้อความขึ้นในแชตแล้ว วันนั้นจะไม่ส่งซ้ำ                              |
| `uncertain` | ไม่แน่ใจว่าส่งสำเร็จหรือไม่ ให้เข้าไปเช็คเองใน TikTok วันนั้นจะไม่ส่งซ้ำ |

ระบบเลือก "ไม่ส่ง" ดีกว่า "ส่งซ้ำ" ถ้าเจอ `pending` หรือ `uncertain` ให้เข้าไปดูและส่งเองใน TikTok ถ้าจำเป็น **ห้ามลบฐานข้อมูลหรือเปลี่ยน `DATA_DIR` เพื่อส่งใหม่** วันถัดไปจะส่งได้ตามปกติ

## การแก้ปัญหา

| Error                   | วิธีแก้                                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `Invalid configuration` | เทียบ `config.json` กับ `config.example.json` ดู path ที่บอกใน log                                                         |
| `AUTH_REQUIRED`         | รัน `bun run login` ใหม่ ถ้าล็อกอินอยู่แล้วให้ตรวจ selector `authenticated`                                                |
| `SECURITY_CHALLENGE`    | หยุดใช้งานอัตโนมัติ เข้าไปจัดการ CAPTCHA / ข้อจำกัดเองใน TikTok                                                            |
| `UI_CHANGED`            | selector ไม่ตรงหรือเจอหลายอัน หรือมีข้อความค้างในช่องพิมพ์ กลับไปขั้นตอนที่ 5                                              |
| `IDENTITY_MISMATCH`     | username ที่หัวแชตไม่ตรงกับ config ตรวจ `conversationUrl` และ `username`                                                   |
| `TRANSIENT_NAVIGATION`  | ตรวจอินเทอร์เน็ต และรัน `bun run browser:install`                                                                          |
| `LOCKED`                | มีคำสั่งอื่นรันอยู่ ปิดก่อน หรือรอ 2 นาทีถ้าโปรแกรมเพิ่ง crash                                                             |
| `SEND_UNCERTAIN`        | ไม่แน่ใจว่าส่งสำเร็จ เข้าไปเช็คใน TikTok เอง วันนั้นจะไม่ส่งซ้ำ                                                            |
| `DAY_CHANGED`           | ข้ามเที่ยงคืนระหว่างทำงาน ดู `bun run status` ก่อนรันใหม่                                                                  |
| `UNEXPECTED`            | ตรวจว่ามี `config.json`, มีผู้รับที่ `"approved": true` อย่างน้อย 1 คน, สิทธิ์เข้าถึงโฟลเดอร์, และไม่ได้เปลี่ยน `timezone` |
| ตั้งเวลาแล้วไม่ส่ง      | ตรวจ 3 ค่าของโหมดจริง, `approved`, `bun run status` ว่าวันนี้ส่งไปแล้วหรือยัง และเครื่องเปิดอยู่ตอนถึงเวลาไหม              |

## ความปลอดภัย

- `DATA_DIR` มี session ที่ล็อกอิน TikTok อยู่ ใครได้โฟลเดอร์นี้ไปก็เข้าบัญชีคุณได้ ควรเปิด FileVault / BitLocker
- ห้าม commit `config.json`, `.env`, หรือ `data/` (git ignore ไว้แล้ว)
- ผลลัพธ์ของ `chats` และ `status` มี username และข้อมูลแชต ลบข้อมูลส่วนตัวออกก่อนแชร์
- ใช้กับเพื่อนที่ยินยอมเท่านั้น และอ่านเงื่อนไขการใช้งานของ TikTok ก่อนเปิดโหมดอัตโนมัติ
