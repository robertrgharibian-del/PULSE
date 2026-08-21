require("dotenv").config();
const express = require("express");
require("express-async-errors"); // forwards rejected promises from async route handlers to next(err) instead of crashing the process
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const ExcelJS = require("exceljs");
const PptxGenJS = require("pptxgenjs");
const nodemailer = require("nodemailer");
const { createEvents } = require("ics");
const multer = require("multer");
const PDFDocument = require("pdfkit");
const { PDFDocument: PdfLibDocument } = require("pdf-lib");
const cron = require("node-cron");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const { TERRITORIES, parseFssWorkbook, parseTargetsWorkbook, monthToCalendarYear } = require("./import.js");
const { aiEnabled, AI_MODEL, buildAnalyticsContext, callClaude, callClaudeTeamAnalysis, callClaudeForNavi } = require("./ai.js");

const app = express();
app.use(cors({ origin: process.env.CLIENT_URL || "*" }));
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret";

/* ============================================================
   Email reminders — Action Plan control/completion dates as
   calendar invites (.ics). Silently no-ops if SMTP_HOST isn't set,
   so the app works fine without email configured.
   ============================================================ */
const mailEnabled = !!process.env.SMTP_HOST;
const transporter = mailEnabled
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

function dateToIcsArray(dateStr) {
  const d = new Date(dateStr);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()];
}

async function sendActionPlanReminders(mp, rmEmail, items) {
  if (!mailEnabled) return;
  const events = [];
  for (const it of items) {
    if (it.control_date) {
      events.push({
        title: `[Action Plan] Контроль: ${it.product_name || "препарат"}`,
        description: `Цель: ${it.goal || "-"}\nДействие: ${it.action_text || "-"}`,
        start: dateToIcsArray(it.control_date),
        duration: { hours: 1 },
        alarms: [{ action: "display", trigger: { hours: 9, before: true } }],
      });
    }
    if (it.completion_date) {
      events.push({
        title: `[Action Plan] Завершение: ${it.product_name || "препарат"}`,
        description: `Цель: ${it.goal || "-"}\nДействие: ${it.action_text || "-"}`,
        start: dateToIcsArray(it.completion_date),
        duration: { hours: 1 },
        alarms: [{ action: "display", trigger: { hours: 9, before: true } }],
      });
    }
  }
  if (!events.length) return;
  const { error, value } = createEvents(events);
  if (error) { console.error("ics build error:", error); return; }
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: mp.email,
      cc: rmEmail || undefined,
      subject: `Action Plan — напоминания (${events.length})`,
      text: "Во вложении — календарные напоминания по датам контроля/завершения из вашего Action Plan.",
      icalEvent: { filename: "action-plan.ics", method: "PUBLISH", content: value },
    });
  } catch (e) {
    console.error("Failed to send action plan reminder email:", e.message);
  }
}

/* ============================================================
   Bonus policy helpers (Incentive Policy FY'27)
   ============================================================ */
function bonusFor(achievement, baseRate) {
  if (achievement < 0.9) return 0;
  if (achievement < 1.0) return baseRate * 0.6 * achievement;
  if (achievement <= 1.25) return baseRate * achievement;
  return baseRate * 1.25;
}
const MONTH_NAMES_RU = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
function monthNameRu(m) { return MONTH_NAMES_RU[(m - 1 + 12) % 12]; }
function sanitizeFilename(s) { return String(s || "").replace(/[\\/:*?"<>|]/g, "").trim(); }
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function reportExportFilename(data, ext) {
  return `${sanitizeFilename(data.mp.full_name)}_${monthNameRu(data.report.period_month)}_${data.report.period_year}_${todayStr()}.${ext}`;
}
function analyticsExportFilename(data, ext) {
  return `Аналитика_${sanitizeFilename(data.scope_label)}_${todayStr()}.${ext}`;
}

function tierLabel(achievement) {
  if (achievement < 0.9) return "Нет бонуса (<90%)";
  if (achievement < 1.0) return "60% ставки (90-99.99%)";
  if (achievement <= 1.25) return "100% ставки (100-124.99%)";
  return "Потолок 125%";
}
function quarterOf(month) { return Math.floor((month - 1) / 3) + 1; }
function monthsInQuarter(q) { return [3 * (q - 1) + 1, 3 * (q - 1) + 2, 3 * (q - 1) + 3]; }
// RM multiplier table (Incentive Policy FY'27, slide "RM bonusi multiplikatori")
function rmMultiplier(achievement) {
  if (achievement < 0.9) return 0;       // RM doesn't qualify personally
  if (achievement < 1.0) return 1.0;     // 90% - 99.99%
  if (achievement < 1.05) return 1.5;    // 100% - 104.99%
  if (achievement < 1.10) return 1.75;   // 105% - 109.99%
  return 2.0;                            // 110%+
}
function rmMultiplierLabel(achievement) {
  if (achievement < 0.9) return "RM не квалифицируется (<90%)";
  if (achievement < 1.0) return "x1.00 (90-99.99%)";
  if (achievement < 1.05) return "x1.50 (100-104.99%)";
  if (achievement < 1.10) return "x1.75 (105-109.99%)";
  return "x2.00 (110%+)";
}
const FFE_LABELS = {
  doctor_coverage_a: "Doctor coverage — Категория A",
  doctor_coverage_b: "Doctor coverage — Категория B",
  core_doctor_coverage_a: "Core doctor coverage — Категория A",
  core_doctor_coverage_b: "Core doctor coverage — Категория B",
  doctor_call_coverage_a: "Doctor call coverage — Категория A",
  doctor_call_coverage_b: "Doctor call coverage — Категория B",
  core_call_coverage_a: "Core call coverage — Категория A",
  core_call_coverage_b: "Core call coverage — Категория B",
  pharmacy_coverage_a: "Pharmacy coverage — Категория A",
  pharmacy_coverage_b: "Pharmacy coverage — Категория B",
};
const FFE_GATE = 0.85; // minimum overall FFE score required for incentive eligibility

/* ============================================================
   Auth middleware
   ============================================================ */
async function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = (header.startsWith("Bearer ") ? header.slice(7) : null) || req.query.token || null;
  if (!token) return res.status(401).json({ error: "No token" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // Territory/group can change after a token was issued (or the token may predate
    // territory being added to the JWT at all) — always use the current DB value.
    const fresh = await pool.query("select territory, group_id, is_active from users where id=$1", [payload.id]);
    if (!fresh.rows[0] || !fresh.rows[0].is_active) return res.status(401).json({ error: "Invalid token" });
    req.user = { ...payload, territory: fresh.rows[0].territory, group_id: fresh.rows[0].group_id };
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid token" });
  }
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "Forbidden" });
    next();
  };
}

/* ============================================================
   Access-control helper: can this user see this report?
   ============================================================ */
async function canAccessReport(user, report) {
  if (user.role === "master") return true;
  if (user.role === "mp") return report.mp_id === user.id;
  if (user.role === "rm") {
    if (report.status === "draft") return false;
    const r = await pool.query("select rm_id from users where id = $1", [report.mp_id]);
    return r.rows[0] && r.rows[0].rm_id === user.id;
  }
  if (user.role === "bm") {
    if (report.status !== "approved") return false;
    const r = await pool.query("select group_id from users where id = $1", [report.mp_id]);
    return r.rows[0] && r.rows[0].group_id === user.group_id;
  }
  return false;
}

/* ============================================================
   AUTH ROUTES
   ============================================================ */
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "email и пароль обязательны" });
  const { rows } = await pool.query("select * from users where email = $1 and is_active = true", [email.toLowerCase()]);
  const user = rows[0];
  if (!user) return res.status(401).json({ error: "Неверный email или пароль" });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "Неверный email или пароль" });
  const token = jwt.sign(
    { id: user.id, role: user.role, full_name: user.full_name, email: user.email, group_id: user.group_id, territory: user.territory },
    JWT_SECRET,
    { expiresIn: "12h" }
  );
  res.json({
    token,
    user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role, territory: user.territory, rm_id: user.rm_id, group_id: user.group_id },
  });
});

app.get("/api/auth/me", auth, async (req, res) => {
  const { rows } = await pool.query(
    `select u.id, u.email, u.full_name, u.role, u.territory, u.rm_id, u.group_id, g.name as group_name
     from users u left join groups g on g.id = u.group_id where u.id = $1`,
    [req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Not found" });
  res.json(rows[0]);
});

/* ============================================================
   USERS — master creates RM and MP accounts
   ============================================================ */
// list RMs (used to populate "attach to RM" dropdown when creating an MP)
app.get("/api/users/rms", auth, requireRole("master"), async (req, res) => {
  const { rows } = await pool.query("select id, full_name, email, territory from users where role = 'rm' and is_active = true order by full_name");
  res.json(rows);
});

// list users (master: everyone; rm: their own MPs)
app.get("/api/users", auth, async (req, res) => {
  const showArchived = req.query.archived === "true";
  const activeFilter = showArchived ? "u.is_active = false" : "u.is_active = true";
  if (req.user.role === "master") {
    const { rows } = await pool.query(
      `select u.id, u.email, u.full_name, u.role, u.territory, u.rm_id, u.group_id, u.is_active, rm.full_name as rm_name, g.name as group_name
       from users u left join users rm on rm.id = u.rm_id left join groups g on g.id = u.group_id
       where ${activeFilter}
       order by u.role, u.full_name`
    );
    return res.json(rows);
  }
  if (req.user.role === "rm") {
    const { rows } = await pool.query(
      `select u.id, u.email, u.full_name, u.role, u.territory, u.group_id, u.is_active, g.name as group_name
       from users u left join groups g on g.id = u.group_id where u.rm_id = $1 and u.is_active = true order by u.full_name`,
      [req.user.id]
    );
    return res.json(rows);
  }
  if (req.user.role === "bm") {
    const { rows } = await pool.query(
      `select u.id, u.email, u.full_name, u.role, u.territory, u.rm_id, u.group_id, u.is_active, rm.full_name as rm_name, g.name as group_name
       from users u left join users rm on rm.id = u.rm_id left join groups g on g.id = u.group_id
       where u.group_id = $1 and u.role = 'mp' and u.is_active = true order by u.full_name`,
      [req.user.group_id]
    );
    return res.json(rows);
  }
  return res.status(403).json({ error: "Forbidden" });
});

app.post("/api/users", auth, requireRole("master"), async (req, res) => {
  const { email, password, full_name, role, rm_id, territory, group_id } = req.body;
  if (!email || !password || !full_name || !role) return res.status(400).json({ error: "Заполните все обязательные поля" });
  if (!["rm", "mp", "bm"].includes(role)) return res.status(400).json({ error: "Недопустимая роль" });
  if (role === "mp" && !rm_id) return res.status(400).json({ error: "Для медпреда обязательно нужно указать РМ" });
  if (role === "mp") {
    const isBuiltin = TERRITORIES.some((t) => t.label === territory);
    const isCustom = !isBuiltin && (await pool.query("select 1 from custom_territories where label=$1", [territory])).rows.length > 0;
    if (!isBuiltin && !isCustom) return res.status(400).json({ error: "Выберите территорию из списка" });
  }
  if ((role === "mp" || role === "bm") && !group_id) {
    return res.status(400).json({ error: "Укажите группу (портфолио)" });
  }
  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await pool.query(
      `insert into users (email, password_hash, full_name, role, rm_id, territory, group_id)
       values ($1,$2,$3,$4,$5,$6,$7) returning id, email, full_name, role, rm_id, territory, group_id`,
      [email.toLowerCase(), hash, full_name, role, role === "mp" ? rm_id : null, territory || null, (role === "mp" || role === "bm") ? group_id : null]
    );
    res.json(rows[0]);
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Такой email уже зарегистрирован" });
    console.error(e);
    res.status(500).json({ error: "Ошибка создания пользователя" });
  }
});

app.patch("/api/users/:id", auth, requireRole("master"), async (req, res) => {
  const { is_active, territory, rm_id, full_name, group_id, email, password } = req.body;
  const fields = [];
  const values = [];
  let i = 1;
  const plain = { is_active, territory, rm_id, full_name, group_id };
  for (const [k, v] of Object.entries(plain)) {
    if (v !== undefined) {
      fields.push(`${k} = $${i++}`);
      values.push(v);
    }
  }
  if (email !== undefined && email.trim()) {
    fields.push(`email = $${i++}`);
    values.push(email.trim().toLowerCase());
  }
  if (password) {
    const hash = await bcrypt.hash(password, 10);
    fields.push(`password_hash = $${i++}`);
    values.push(hash);
  }
  if (!fields.length) return res.status(400).json({ error: "Нет полей для обновления" });
  values.push(req.params.id);
  try {
    await pool.query(`update users set ${fields.join(", ")} where id = $${i}`, values);
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Такой email уже используется другим аккаунтом" });
    throw e;
  }
  if (password) {
    await pool.query("update password_reset_requests set status='resolved', resolved_at=now() where user_id=$1 and status='pending'", [req.params.id]);
  }
  res.json({ ok: true });
});

/* ---- RM-managed territories: a РМ can oversee several territories, independent of which MPs are currently assigned ---- */
async function canViewRmTerritories(user, rmId) {
  if (user.role === "master") return true;
  if (user.role === "rm") return String(user.id) === String(rmId);
  if (user.role === "bm") {
    const t = await pool.query("select 1 from users where rm_id=$1 and group_id=$2 and role='mp' limit 1", [rmId, user.group_id]);
    return t.rows.length > 0;
  }
  return false;
}

app.get("/api/users/:id/territories", auth, async (req, res) => {
  const { id } = req.params;
  if (!(await canViewRmTerritories(req.user, id))) return res.status(403).json({ error: "Forbidden" });
  const { rows } = await pool.query("select * from rm_territories where rm_id=$1 order by territory", [id]);
  res.json(rows);
});

app.post("/api/users/:id/territories", auth, requireRole("master"), async (req, res) => {
  const { id } = req.params;
  const { territory } = req.body;
  if (!territory || !territory.trim()) return res.status(400).json({ error: "Укажите территорию" });
  const check = await pool.query("select role from users where id=$1", [id]);
  if (!check.rows[0] || check.rows[0].role !== "rm") return res.status(400).json({ error: "Это не аккаунт РМ" });
  try {
    const { rows } = await pool.query("insert into rm_territories (rm_id, territory) values ($1,$2) returning *", [id, territory.trim()]);
    res.json(rows[0]);
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Эта территория уже добавлена" });
    throw e;
  }
});

app.delete("/api/users/:id/territories/:territoryId", auth, requireRole("master"), async (req, res) => {
  const { id, territoryId } = req.params;
  await pool.query("delete from rm_territories where id=$1 and rm_id=$2", [territoryId, id]);
  res.json({ ok: true });
});

app.delete("/api/users/:id", auth, requireRole("master"), async (req, res) => {
  const { id } = req.params;
  if (String(id) === String(req.user.id)) return res.status(400).json({ error: "Нельзя удалить собственный аккаунт" });
  const check = await pool.query("select role from users where id=$1", [id]);
  if (!check.rows[0]) return res.status(404).json({ error: "Пользователь не найден" });
  await pool.query("update users set is_active=false where id=$1", [id]);
  res.json({ ok: true });
});

app.delete("/api/users/:id/permanent", auth, requireRole("master"), async (req, res) => {
  const { id } = req.params;
  if (String(id) === String(req.user.id)) return res.status(400).json({ error: "Нельзя удалить собственный аккаунт" });
  const check = await pool.query("select role, is_active from users where id=$1", [id]);
  if (!check.rows[0]) return res.status(404).json({ error: "Пользователь не найден" });
  if (check.rows[0].is_active) return res.status(400).json({ error: "Сначала переместите аккаунт в архив" });
  await pool.query("delete from users where id=$1", [id]);
  res.json({ ok: true });
});

/* ---- Password reset requests: user requests -> master resolves ---- */
app.post("/api/auth/request-reset", async (req, res) => {
  const { email } = req.body;
  if (email) {
    const u = await pool.query("select id from users where email=$1 and is_active=true", [email.toLowerCase()]);
    if (u.rows[0]) {
      await pool.query("insert into password_reset_requests (user_id) values ($1)", [u.rows[0].id]);
    }
  }
  // always return success — don't reveal whether the email exists
  res.json({ ok: true });
});

app.get("/api/password-resets", auth, requireRole("master"), async (req, res) => {
  const { rows } = await pool.query(
    `select p.*, u.full_name, u.email, u.role from password_reset_requests p
     join users u on u.id = p.user_id where p.status='pending' order by p.requested_at desc`
  );
  res.json(rows);
});

/* ---- Profile: any logged-in user can update their own basic info ---- */
app.put("/api/auth/me", auth, async (req, res) => {
  const { full_name, password, current_password } = req.body;
  const fields = [];
  const values = [];
  let i = 1;
  if (full_name) { fields.push(`full_name = $${i++}`); values.push(full_name); }
  if (password) {
    if (!current_password) return res.status(400).json({ error: "Укажите текущий пароль" });
    const u = await pool.query("select password_hash from users where id=$1", [req.user.id]);
    const ok = await bcrypt.compare(current_password, u.rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: "Текущий пароль неверен" });
    const hash = await bcrypt.hash(password, 10);
    fields.push(`password_hash = $${i++}`);
    values.push(hash);
  }
  if (!fields.length) return res.status(400).json({ error: "Нечего обновлять" });
  values.push(req.user.id);
  await pool.query(`update users set ${fields.join(", ")} where id=$${i}`, values);
  res.json({ ok: true });
});

/* ---- Profile photo: shown everywhere the person's name appears.
   Only the master account can set/change photos — not self-service. ---- */
app.post("/api/users/:id/photo", auth, requireRole("master"), upload.single("photo"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Файл не получен" });
  if (!req.file.mimetype.startsWith("image/")) return res.status(400).json({ error: "Загрузите изображение" });
  await pool.query("update users set photo_data=$1, photo_mime=$2 where id=$3", [req.file.buffer, req.file.mimetype, req.params.id]);
  res.json({ ok: true });
});

app.get("/api/users/:id/photo", auth, async (req, res) => {
  const { rows } = await pool.query("select photo_data, photo_mime from users where id=$1", [req.params.id]);
  if (!rows[0] || !rows[0].photo_data) return res.status(404).end();
  res.setHeader("Content-Type", rows[0].photo_mime);
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.end(rows[0].photo_data);
});

/* ============================================================
   PRODUCTS
   ============================================================ */
app.get("/api/products", auth, async (req, res) => {
  const { rows } = await pool.query("select * from products order by sort_order");
  res.json(rows);
});

/* ============================================================
   TERRITORIES — fixed catalog used for MP account creation and imports
   ============================================================ */
app.get("/api/territories", auth, async (req, res) => {
  const custom = await pool.query("select id, label from custom_territories order by label");
  const builtin = TERRITORIES.map((t) => ({ key: t.key, label: t.label }));
  const customMapped = custom.rows.map((t) => ({ key: `custom_${t.id}`, label: t.label }));
  res.json([...builtin, ...customMapped]);
});

app.post("/api/territories", auth, requireRole("master"), async (req, res) => {
  const { label } = req.body;
  if (!label || !label.trim()) return res.status(400).json({ error: "Укажите название территории" });
  const trimmed = label.trim();
  if (TERRITORIES.some((t) => t.label.toLowerCase() === trimmed.toLowerCase())) {
    return res.status(409).json({ error: "Такая территория уже есть во встроенном списке" });
  }
  try {
    const { rows } = await pool.query("insert into custom_territories (label) values ($1) returning *", [trimmed]);
    res.json({ key: `custom_${rows[0].id}`, label: rows[0].label });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Такая территория уже добавлена" });
    throw e;
  }
});

/* ============================================================
   GROUPS — brand/portfolio groups (Rhythm, Prime, ...). Used to tag
   MP/BM accounts and products so BM oversight & Portfolio stay scoped.
   ============================================================ */
app.get("/api/groups", auth, async (req, res) => {
  const showArchived = req.query.archived === "true";
  const { rows } = await pool.query(`select * from groups where is_active = $1 order by name`, [!showArchived]);
  res.json(rows);
});

app.post("/api/groups", auth, requireRole("master"), async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Укажите название группы" });
  try {
    const { rows } = await pool.query("insert into groups (name) values ($1) returning *", [name.trim()]);
    res.json(rows[0]);
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Такая группа уже существует" });
    throw e;
  }
});

app.delete("/api/groups/:id", auth, requireRole("master"), async (req, res) => {
  const { id } = req.params;
  await pool.query("update groups set is_active=false where id=$1", [id]);
  res.json({ ok: true });
});

app.patch("/api/groups/:id", auth, requireRole("master"), async (req, res) => {
  const { id } = req.params;
  const { is_active, name } = req.body;
  const fields = []; const values = []; let i = 1;
  if (is_active !== undefined) { fields.push(`is_active = $${i++}`); values.push(is_active); }
  if (name !== undefined && name.trim()) { fields.push(`name = $${i++}`); values.push(name.trim()); }
  if (!fields.length) return res.status(400).json({ error: "Нет полей для обновления" });
  values.push(id);
  await pool.query(`update groups set ${fields.join(", ")} where id=$${i}`, values);
  res.json({ ok: true });
});

/* ============================================================
   BRANDS — group several SKUs under one brand (e.g. "Atorem" groups
   Atorem 10/20/40mg). A brand can be linked to a team (Rhythm/Prime/...).
   Master and BM (own group only) can manage brands.
   ============================================================ */
function brandGroupScope(user) {
  if (user.role === "master") return { where: "1=1", values: [] };
  if (user.role === "bm") return { where: "b.group_id = $1", values: [user.group_id] };
  return { where: "1=0", values: [] };
}

app.get("/api/brands", auth, async (req, res) => {
  const scope = brandGroupScope(req.user);
  const showArchived = req.query.archived === "true";
  const params = [...scope.values];
  params.push(!showArchived);
  const { rows } = await pool.query(
    `select b.*, g.name as group_name, (select count(*) from products p where p.brand_id=b.id and p.is_active=true) as sku_count
     from brands b left join groups g on g.id=b.group_id
     where (${scope.where}) and b.is_active = $${params.length}
     order by b.name`,
    params
  );
  res.json(rows);
});

app.post("/api/brands", auth, requireRole("master", "bm"), async (req, res) => {
  const { name, group_id } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Укажите название бренда" });
  const finalGroupId = req.user.role === "bm" ? req.user.group_id : (group_id || null);
  const { rows } = await pool.query(
    "insert into brands (name, group_id) values ($1,$2) returning *",
    [name.trim(), finalGroupId]
  );
  res.json(rows[0]);
});

async function canManageBrand(user, brandId) {
  if (user.role === "master") return true;
  if (user.role === "bm") {
    const r = await pool.query("select group_id from brands where id=$1", [brandId]);
    return r.rows[0]?.group_id === user.group_id;
  }
  return false;
}

app.put("/api/brands/:id", auth, requireRole("master", "bm"), async (req, res) => {
  const { id } = req.params;
  if (!(await canManageBrand(req.user, id))) return res.status(403).json({ error: "Forbidden" });
  const { name, group_id } = req.body;
  const fields = []; const values = []; let i = 1;
  if (name !== undefined && name.trim()) { fields.push(`name = $${i++}`); values.push(name.trim()); }
  if (group_id !== undefined && req.user.role === "master") { fields.push(`group_id = $${i++}`); values.push(group_id || null); }
  if (!fields.length) return res.status(400).json({ error: "Нет полей для обновления" });
  values.push(id);
  await pool.query(`update brands set ${fields.join(", ")} where id=$${i}`, values);
  // Every SKU in this brand follows the brand's team — keep them in sync automatically
  if (group_id !== undefined && req.user.role === "master") {
    await pool.query("update products set group_id=$1 where brand_id=$2", [group_id || null, id]);
  }
  res.json({ ok: true });
});

app.delete("/api/brands/:id", auth, requireRole("master", "bm"), async (req, res) => {
  const { id } = req.params;
  if (!(await canManageBrand(req.user, id))) return res.status(403).json({ error: "Forbidden" });
  // Unlink SKUs first (they stay in Portfolio, just no longer grouped under this brand), then remove the brand
  await pool.query("update products set brand_id=null where brand_id=$1", [id]);
  await pool.query("delete from brands where id=$1", [id]);
  res.json({ ok: true });
});

/* ============================================================
   PORTFOLIO — product cards: PIL, visual-aid slides, key messages,
   positioning, patient portraits, competitors (manual prices).
   Visibility scoped by group; BM (own group) and Master can edit.
   ============================================================ */
const CONFIDENTIALITY_NOTICE =
  "Информация, представленная в этом материале, является абсолютно конфиденциальной и не должна быть " +
  "использована, продемонстрирована в любых случаях и ситуациях, кроме как внутри компании MSN Laboratories.";

async function portfolioScope(user, startIndex = 1) {
  if (user.role === "master") return { where: "1=1", values: [] };
  if (user.role === "mp" || user.role === "bm") return { where: `p.group_id = $${startIndex}`, values: [user.group_id] };
  if (user.role === "rm") {
    return {
      where: `p.group_id in (select distinct group_id from users where rm_id = $${startIndex} and group_id is not null)`,
      values: [user.id],
    };
  }
  return { where: "1=0", values: [] };
}
function canEditProduct(user, groupId) {
  if (user.role === "master") return true;
  if (user.role === "bm") return user.group_id === groupId;
  return false;
}

app.get("/api/portfolio", auth, async (req, res) => {
  const scope = await portfolioScope(req.user);
  const { rows } = await pool.query(
    `select p.id, p.name, p.nrv_usd, p.group_id, g.name as group_name, p.brand_id, b.name as brand_name,
            (select count(*) from product_files f where f.product_id=p.id and f.file_type='pil') as pil_count,
            (select count(*) from product_files f where f.product_id=p.id and f.file_type='slides') as slides_count
     from products p left join groups g on g.id=p.group_id left join brands b on b.id=p.brand_id
     where p.is_active=true and ${scope.where} order by p.sort_order, p.name`,
    scope.values
  );
  res.json(rows);
});

app.post("/api/portfolio", auth, requireRole("master", "bm"), async (req, res) => {
  const { name, nrv_usd, brand_id } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Укажите название препарата" });
  let gid = req.user.role === "bm" ? req.user.group_id : null;
  if (brand_id) {
    const b = await pool.query("select group_id from brands where id=$1", [brand_id]);
    if (!b.rows[0]) return res.status(400).json({ error: "Бренд не найден" });
    if (req.user.role === "bm" && b.rows[0].group_id !== req.user.group_id) return res.status(403).json({ error: "Forbidden" });
    gid = b.rows[0].group_id;
  }
  const { rows } = await pool.query(
    "insert into products (name, nrv_usd, group_id, brand_id, sort_order) values ($1,$2,$3,$4,999) returning *",
    [name.trim(), nrv_usd || 0, gid, brand_id || null]
  );
  res.json(rows[0]);
});

app.get("/api/portfolio/:id", auth, async (req, res) => {
  const { id } = req.params;
  const scope = await portfolioScope(req.user, 2);
  const pRes = await pool.query(
    `select p.*, g.name as group_name, b.name as brand_name from products p left join groups g on g.id=p.group_id left join brands b on b.id=p.brand_id where p.id=$1 and p.is_active=true and (${scope.where})`,
    [id, ...scope.values]
  );
  if (!pRes.rows[0]) return res.status(403).json({ error: "Forbidden" });
  const filesRes = await pool.query(
    "select id, file_type, file_name, mime_type, created_at from product_files where product_id=$1 order by created_at desc",
    [id]
  );
  const compRes = await pool.query("select * from product_competitors where product_id=$1 order by is_direct desc, competitor_name", [id]);
  const prices = compRes.rows.filter((c) => c.competitor_price_usd != null).map((c) => Number(c.competitor_price_usd));
  const avgCompetitorPrice = prices.length ? prices.reduce((s, x) => s + x, 0) / prices.length : null;

  const visualAidsRes = await pool.query(
    "select id, image_mime, image_name, content_desc, purpose, detail_script, comments, created_at from product_visual_aids where product_id=$1 order by sort_order, created_at",
    [id]
  );
  const promoRes = await pool.query(
    "select id, file_mime, file_name, material_name, material_type, target_audience, content_desc, purpose, detail_script, comments, created_at from product_promo_materials where product_id=$1 order by sort_order, created_at",
    [id]
  );
  const sciRes = await pool.query(
    "select id, file_mime, file_name, title, comments, created_at from product_scientific_info where product_id=$1 order by created_at desc",
    [id]
  );

  res.json({
    product: pRes.rows[0],
    files: filesRes.rows,
    competitors: compRes.rows,
    avg_competitor_price_usd: avgCompetitorPrice,
    visual_aids: visualAidsRes.rows,
    promo_materials: promoRes.rows,
    scientific_info: sciRes.rows,
    can_edit: canEditProduct(req.user, pRes.rows[0].group_id),
  });
});

app.put("/api/portfolio/:id", auth, requireRole("master", "bm"), async (req, res) => {
  const { id } = req.params;
  const pRes = await pool.query("select group_id from products where id=$1", [id]);
  if (!pRes.rows[0] || !canEditProduct(req.user, pRes.rows[0].group_id)) return res.status(403).json({ error: "Forbidden" });
  const { name, key_messages, positioning, patient_portraits, nrv_usd, brand_id } = req.body;
  await pool.query(
    `update products set name=coalesce($1,name), key_messages=coalesce($2,key_messages), positioning=coalesce($3,positioning),
     patient_portraits=coalesce($4,patient_portraits), nrv_usd=coalesce($5,nrv_usd), updated_at=now() where id=$6`,
    [name, key_messages, positioning, patient_portraits, nrv_usd, id]
  );
  // brand_id handled separately: undefined = don't touch, null/"" = explicitly unlink from any brand.
  // The SKU's team is always derived from its brand — assigning a brand re-tags the SKU with that brand's team automatically.
  if (brand_id !== undefined) {
    if (brand_id) {
      const b = await pool.query("select group_id from brands where id=$1", [brand_id]);
      if (!b.rows[0]) return res.status(400).json({ error: "Бренд не найден" });
      if (req.user.role === "bm" && b.rows[0].group_id !== req.user.group_id) return res.status(403).json({ error: "Forbidden" });
      await pool.query("update products set brand_id=$1, group_id=$2 where id=$3", [brand_id, b.rows[0].group_id, id]);
    } else {
      await pool.query("update products set brand_id=null where id=$1", [id]);
    }
  }
  res.json({ ok: true });
});

app.delete("/api/portfolio/:id", auth, requireRole("master", "bm"), async (req, res) => {
  const { id } = req.params;
  const pRes = await pool.query("select group_id from products where id=$1", [id]);
  if (!pRes.rows[0] || !canEditProduct(req.user, pRes.rows[0].group_id)) return res.status(403).json({ error: "Forbidden" });
  await pool.query("update products set is_active=false, updated_at=now() where id=$1", [id]);
  res.json({ ok: true });
});

app.post("/api/portfolio/:id/files", auth, requireRole("master", "bm"), upload.single("file"), async (req, res) => {
  const { id } = req.params;
  const pRes = await pool.query("select group_id from products where id=$1", [id]);
  if (!pRes.rows[0] || !canEditProduct(req.user, pRes.rows[0].group_id)) return res.status(403).json({ error: "Forbidden" });
  if (!req.file) return res.status(400).json({ error: "Файл не получен" });
  const { file_type } = req.body;
  if (file_type !== "pil") return res.status(400).json({ error: "Неверный тип файла" });
  const { rows } = await pool.query(
    "insert into product_files (product_id, file_type, file_name, mime_type, file_data, uploaded_by) values ($1,$2,$3,$4,$5,$6) returning id, file_type, file_name, mime_type, created_at",
    [id, file_type, req.file.originalname, req.file.mimetype, req.file.buffer, req.user.id]
  );
  res.json(rows[0]);
});

app.get("/api/portfolio/files/:fileId", auth, async (req, res) => {
  const { fileId } = req.params;
  const scope = await portfolioScope(req.user, 2);
  const fRes = await pool.query(
    `select f.*, p.group_id from product_files f join products p on p.id=f.product_id where f.id=$1 and (${scope.where})`,
    [fileId, ...scope.values]
  );
  const file = fRes.rows[0];
  if (!file) return res.status(403).json({ error: "Forbidden" });
  res.setHeader("Content-Type", file.mime_type);
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file.file_name)}"`);
  res.end(file.file_data);
});

app.delete("/api/portfolio/files/:fileId", auth, requireRole("master", "bm"), async (req, res) => {
  const { fileId } = req.params;
  const fRes = await pool.query(
    `select f.id, p.group_id from product_files f join products p on p.id=f.product_id where f.id=$1`, [fileId]
  );
  if (!fRes.rows[0] || !canEditProduct(req.user, fRes.rows[0].group_id)) return res.status(403).json({ error: "Forbidden" });
  await pool.query("delete from product_files where id=$1", [fileId]);
  res.json({ ok: true });
});

/* ---- Visual Aid slides: image + talk-track detail fields ---- */
app.post("/api/portfolio/:id/visual-aids", auth, requireRole("master", "bm"), upload.single("image"), async (req, res) => {
  const { id } = req.params;
  const pRes = await pool.query("select group_id from products where id=$1", [id]);
  if (!pRes.rows[0] || !canEditProduct(req.user, pRes.rows[0].group_id)) return res.status(403).json({ error: "Forbidden" });
  if (!req.file) return res.status(400).json({ error: "Загрузите изображение слайда" });
  const { content_desc, purpose, detail_script, comments } = req.body;
  const { rows } = await pool.query(
    `insert into product_visual_aids (product_id, image_data, image_mime, image_name, content_desc, purpose, detail_script, comments, uploaded_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id, image_mime, image_name, content_desc, purpose, detail_script, comments, created_at`,
    [id, req.file.buffer, req.file.mimetype, req.file.originalname, content_desc || "", purpose || "", detail_script || "", comments || "", req.user.id]
  );
  res.json(rows[0]);
});

app.put("/api/portfolio/visual-aids/:vaId", auth, requireRole("master", "bm"), async (req, res) => {
  const { vaId } = req.params;
  const vRes = await pool.query(`select v.id, p.group_id from product_visual_aids v join products p on p.id=v.product_id where v.id=$1`, [vaId]);
  if (!vRes.rows[0] || !canEditProduct(req.user, vRes.rows[0].group_id)) return res.status(403).json({ error: "Forbidden" });
  const { content_desc, purpose, detail_script, comments } = req.body;
  await pool.query(
    `update product_visual_aids set content_desc=coalesce($1,content_desc), purpose=coalesce($2,purpose),
     detail_script=coalesce($3,detail_script), comments=coalesce($4,comments) where id=$5`,
    [content_desc, purpose, detail_script, comments, vaId]
  );
  res.json({ ok: true });
});

app.delete("/api/portfolio/visual-aids/:vaId", auth, requireRole("master", "bm"), async (req, res) => {
  const { vaId } = req.params;
  const vRes = await pool.query(`select v.id, p.group_id from product_visual_aids v join products p on p.id=v.product_id where v.id=$1`, [vaId]);
  if (!vRes.rows[0] || !canEditProduct(req.user, vRes.rows[0].group_id)) return res.status(403).json({ error: "Forbidden" });
  await pool.query("delete from product_visual_aids where id=$1", [vaId]);
  res.json({ ok: true });
});

app.get("/api/portfolio/visual-aids/:vaId/image", auth, async (req, res) => {
  const { vaId } = req.params;
  const scope = await portfolioScope(req.user, 2);
  const vRes = await pool.query(
    `select v.image_data, v.image_mime, v.image_name, p.group_id from product_visual_aids v join products p on p.id=v.product_id where v.id=$1 and (${scope.where})`,
    [vaId, ...scope.values]
  );
  if (!vRes.rows[0]) return res.status(403).json({ error: "Forbidden" });
  res.setHeader("Content-Type", vRes.rows[0].image_mime);
  res.end(vRes.rows[0].image_data);
});

/* ---- Promo materials: image or PDF, audience targeting, talk-track ---- */
const PROMO_MATERIAL_TYPES = ["Лифлет", "Блокнот", "Кубарик", "Буклет", "Постер", "Бренд ремайндер"];
const AUDIENCE_OPTIONS = ["Кардиолог", "ВОП", "Терапевт", "Интервенционист", "Эндокринолог", "ЛОР", "Педиатр", "Аллерголог", "Пульмонолог", "Провизор", "Пациент"];

app.get("/api/portfolio-options", auth, (req, res) => {
  res.json({ material_types: PROMO_MATERIAL_TYPES, audience_options: AUDIENCE_OPTIONS });
});

app.post("/api/portfolio/:id/promo-materials", auth, requireRole("master", "bm"), upload.single("file"), async (req, res) => {
  const { id } = req.params;
  const pRes = await pool.query("select group_id from products where id=$1", [id]);
  if (!pRes.rows[0] || !canEditProduct(req.user, pRes.rows[0].group_id)) return res.status(403).json({ error: "Forbidden" });
  if (!req.file) return res.status(400).json({ error: "Загрузите файл материала" });
  const { material_name, material_type, target_audience, content_desc, purpose, detail_script, comments } = req.body;
  if (!material_name || !material_name.trim()) return res.status(400).json({ error: "Укажите название материала" });
  let audience = [];
  try { audience = target_audience ? JSON.parse(target_audience) : []; } catch (e) { audience = []; }
  const { rows } = await pool.query(
    `insert into product_promo_materials
     (product_id, file_data, file_mime, file_name, material_name, material_type, target_audience, content_desc, purpose, detail_script, comments, uploaded_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     returning id, file_mime, file_name, material_name, material_type, target_audience, content_desc, purpose, detail_script, comments, created_at`,
    [id, req.file.buffer, req.file.mimetype, req.file.originalname, material_name.trim(), material_type || null, audience, content_desc || "", purpose || "", detail_script || "", comments || "", req.user.id]
  );
  res.json(rows[0]);
});

app.put("/api/portfolio/promo-materials/:pmId", auth, requireRole("master", "bm"), async (req, res) => {
  const { pmId } = req.params;
  const pmRes = await pool.query(`select m.id, p.group_id from product_promo_materials m join products p on p.id=m.product_id where m.id=$1`, [pmId]);
  if (!pmRes.rows[0] || !canEditProduct(req.user, pmRes.rows[0].group_id)) return res.status(403).json({ error: "Forbidden" });
  const { material_name, material_type, target_audience, content_desc, purpose, detail_script, comments } = req.body;
  const audience = Array.isArray(target_audience) ? target_audience : undefined;
  await pool.query(
    `update product_promo_materials set material_name=coalesce($1,material_name), material_type=coalesce($2,material_type),
     target_audience=coalesce($3,target_audience), content_desc=coalesce($4,content_desc), purpose=coalesce($5,purpose),
     detail_script=coalesce($6,detail_script), comments=coalesce($7,comments) where id=$8`,
    [material_name, material_type, audience, content_desc, purpose, detail_script, comments, pmId]
  );
  res.json({ ok: true });
});

app.delete("/api/portfolio/promo-materials/:pmId", auth, requireRole("master", "bm"), async (req, res) => {
  const { pmId } = req.params;
  const pmRes = await pool.query(`select m.id, p.group_id from product_promo_materials m join products p on p.id=m.product_id where m.id=$1`, [pmId]);
  if (!pmRes.rows[0] || !canEditProduct(req.user, pmRes.rows[0].group_id)) return res.status(403).json({ error: "Forbidden" });
  await pool.query("delete from product_promo_materials where id=$1", [pmId]);
  res.json({ ok: true });
});

app.get("/api/portfolio/promo-materials/:pmId/file", auth, async (req, res) => {
  const { pmId } = req.params;
  const scope = await portfolioScope(req.user, 2);
  const mRes = await pool.query(
    `select m.file_data, m.file_mime, m.file_name, p.group_id from product_promo_materials m join products p on p.id=m.product_id where m.id=$1 and (${scope.where})`,
    [pmId, ...scope.values]
  );
  if (!mRes.rows[0]) return res.status(403).json({ error: "Forbidden" });
  res.setHeader("Content-Type", mRes.rows[0].file_mime);
  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(mRes.rows[0].file_name)}"`);
  res.end(mRes.rows[0].file_data);
});

/* ---- Scientific info: articles, studies, any format ---- */
app.post("/api/portfolio/:id/scientific-info", auth, requireRole("master", "bm"), upload.single("file"), async (req, res) => {
  const { id } = req.params;
  const pRes = await pool.query("select group_id from products where id=$1", [id]);
  if (!pRes.rows[0] || !canEditProduct(req.user, pRes.rows[0].group_id)) return res.status(403).json({ error: "Forbidden" });
  if (!req.file) return res.status(400).json({ error: "Загрузите файл" });
  const { title, comments } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: "Укажите название" });
  const { rows } = await pool.query(
    `insert into product_scientific_info (product_id, file_data, file_mime, file_name, title, comments, uploaded_by)
     values ($1,$2,$3,$4,$5,$6,$7) returning id, file_mime, file_name, title, comments, created_at`,
    [id, req.file.buffer, req.file.mimetype, req.file.originalname, title.trim(), comments || "", req.user.id]
  );
  res.json(rows[0]);
});

app.delete("/api/portfolio/scientific-info/:siId", auth, requireRole("master", "bm"), async (req, res) => {
  const { siId } = req.params;
  const sRes = await pool.query(`select s.id, p.group_id from product_scientific_info s join products p on p.id=s.product_id where s.id=$1`, [siId]);
  if (!sRes.rows[0] || !canEditProduct(req.user, sRes.rows[0].group_id)) return res.status(403).json({ error: "Forbidden" });
  await pool.query("delete from product_scientific_info where id=$1", [siId]);
  res.json({ ok: true });
});

app.get("/api/portfolio/scientific-info/:siId/file", auth, async (req, res) => {
  const { siId } = req.params;
  const scope = await portfolioScope(req.user, 2);
  const sRes = await pool.query(
    `select s.file_data, s.file_mime, s.file_name, p.group_id from product_scientific_info s join products p on p.id=s.product_id where s.id=$1 and (${scope.where})`,
    [siId, ...scope.values]
  );
  if (!sRes.rows[0]) return res.status(403).json({ error: "Forbidden" });
  res.setHeader("Content-Type", sRes.rows[0].file_mime);
  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(sRes.rows[0].file_name)}"`);
  res.end(sRes.rows[0].file_data);
});

app.post("/api/portfolio/:id/competitors", auth, requireRole("master", "bm"), async (req, res) => {
  const { id } = req.params;
  const pRes = await pool.query("select group_id from products where id=$1", [id]);
  if (!pRes.rows[0] || !canEditProduct(req.user, pRes.rows[0].group_id)) return res.status(403).json({ error: "Forbidden" });
  const { competitor_name, is_direct, competitor_price_usd } = req.body;
  if (!competitor_name || !competitor_name.trim()) return res.status(400).json({ error: "Укажите название конкурента" });
  const { rows } = await pool.query(
    `insert into product_competitors (product_id, competitor_name, is_direct, competitor_price_usd, price_updated_at, price_updated_by)
     values ($1,$2,$3,$4,$5,$6) returning *`,
    [id, competitor_name.trim(), is_direct !== false, competitor_price_usd || null, competitor_price_usd != null ? new Date() : null, req.user.id]
  );
  res.json(rows[0]);
});

app.put("/api/portfolio/competitors/:cid", auth, requireRole("master", "bm"), async (req, res) => {
  const { cid } = req.params;
  const cRes = await pool.query(
    `select c.id, p.group_id from product_competitors c join products p on p.id=c.product_id where c.id=$1`, [cid]
  );
  if (!cRes.rows[0] || !canEditProduct(req.user, cRes.rows[0].group_id)) return res.status(403).json({ error: "Forbidden" });
  const { competitor_name, is_direct, competitor_price_usd } = req.body;
  await pool.query(
    `update product_competitors set competitor_name=coalesce($1,competitor_name), is_direct=coalesce($2,is_direct),
     competitor_price_usd=$3, price_updated_at=now(), price_updated_by=$4 where id=$5`,
    [competitor_name, is_direct, competitor_price_usd ?? null, req.user.id, cid]
  );
  res.json({ ok: true });
});

app.delete("/api/portfolio/competitors/:cid", auth, requireRole("master", "bm"), async (req, res) => {
  const { cid } = req.params;
  const cRes = await pool.query(
    `select c.id, p.group_id from product_competitors c join products p on p.id=c.product_id where c.id=$1`, [cid]
  );
  if (!cRes.rows[0] || !canEditProduct(req.user, cRes.rows[0].group_id)) return res.status(403).json({ error: "Forbidden" });
  await pool.query("delete from product_competitors where id=$1", [cid]);
  res.json({ ok: true });
});

/* ---- PDF brochure (single product or whole visible portfolio) ---- */
const path = require("path");
const FONT_REGULAR = path.join(__dirname, "fonts", "DejaVuSans.ttf");
const FONT_BOLD = path.join(__dirname, "fonts", "DejaVuSans-Bold.ttf");

const FILE_TYPE_LABEL_RU = { pil: "PIL (инструкция)", slides: "Слайды визуальной поддержки", other: "Материал" };

function drawBrochurePage(doc, data, files) {
  doc.font(FONT_BOLD).fontSize(18).fillColor("#1F2937").text(data.product.name, { continued: false });
  doc.moveDown(0.3);
  doc.font(FONT_REGULAR).fontSize(10).fillColor("#6B7280").text(`Группа: ${data.product.group_name || "—"}   ·   Цена (NRV), $: ${Number(data.product.nrv_usd).toFixed(2)}`);
  doc.moveDown(1);

  const section = (title, text) => {
    doc.font(FONT_BOLD).fontSize(12).fillColor("#C58A1F").text(title);
    doc.moveDown(0.2);
    doc.font(FONT_REGULAR).fontSize(10).fillColor("#1F2937").text(text || "—", { width: 480 });
    doc.moveDown(0.8);
  };
  section("Ключевые сообщения", data.product.key_messages);
  section("Позиционирование", data.product.positioning);
  section("Портреты пациентов", data.product.patient_portraits);

  doc.font(FONT_BOLD).fontSize(12).fillColor("#C58A1F").text("Конкуренты");
  doc.moveDown(0.2);
  doc.font(FONT_REGULAR);
  if (data.competitors.length === 0) {
    doc.fontSize(10).fillColor("#1F2937").text("—");
  } else {
    data.competitors.forEach((c) => {
      const price = c.competitor_price_usd != null ? `$${Number(c.competitor_price_usd).toFixed(2)}` : "цена не указана";
      doc.fontSize(10).fillColor("#1F2937").text(`• ${c.competitor_name} (${c.is_direct ? "прямой" : "непрямой"}) — ${price}`);
    });
    if (data.avg_competitor_price_usd != null) {
      doc.moveDown(0.3);
      doc.fontSize(10).fillColor("#3FB88F").text(`Средняя цена конкурентов: $${data.avg_competitor_price_usd.toFixed(2)} (наша цена: $${Number(data.product.nrv_usd).toFixed(2)})`);
    }
  }

  if (files && files.length > 0) {
    doc.moveDown(1);
    doc.font(FONT_BOLD).fontSize(12).fillColor("#C58A1F").text("PIL (инструкция по применению)");
    doc.moveDown(0.2);
    doc.font(FONT_REGULAR);
    files.forEach((f) => {
      const embedded = f.mime_type === "application/pdf";
      const note = embedded ? "— страницы приложены далее" : `— формат ${f.mime_type.split("/")[1] || f.mime_type}, скачайте отдельно в системе`;
      doc.fontSize(10).fillColor(embedded ? "#1F2937" : "#8493AA").text(`• ${f.file_name} ${note}`);
    });
  }

  doc.moveDown(1);
  doc.fontSize(8).fillColor("#B71C1C").text(CONFIDENTIALITY_NOTICE, { width: 480 });
}

// Image + a set of labelled detail fields, laid out side by side (image left, text right)
function drawImageWithFieldsPage(doc, imageBuffer, imageMime, title, fields) {
  doc.font(FONT_BOLD).fontSize(14).fillColor("#3E4095").text(title, { width: 495 });
  doc.moveDown(0.5);
  const imgY = doc.y;
  const imgW = 260, imgH = 320;
  try {
    doc.image(imageBuffer, 50, imgY, { fit: [imgW, imgH] });
  } catch (e) {
    doc.font(FONT_REGULAR).fontSize(9).fillColor("#8493AA").text("[изображение не может быть встроено]", 50, imgY);
  }
  let textX = 50 + imgW + 20;
  let textY = imgY;
  const textW = 495 - imgW - 20;
  fields.forEach(([label, value]) => {
    if (!value) return;
    doc.font(FONT_BOLD).fontSize(10).fillColor("#C58A1F").text(label, textX, textY, { width: textW });
    textY = doc.y + 2;
    doc.font(FONT_REGULAR).fontSize(9).fillColor("#1F2937").text(value, textX, textY, { width: textW });
    textY = doc.y + 10;
  });
  doc.y = Math.max(imgY + imgH, textY) + 10;
  doc.x = 50;
  doc.font(FONT_REGULAR).fontSize(7).fillColor("#B71C1C").text(CONFIDENTIALITY_NOTICE, 50, doc.y, { width: 495 });
}

function drawTextOnlyDetailsPage(doc, title, fields) {
  doc.font(FONT_BOLD).fontSize(14).fillColor("#3E4095").text(title, { width: 495 });
  doc.moveDown(0.5);
  fields.forEach(([label, value]) => {
    if (!value) return;
    doc.font(FONT_BOLD).fontSize(10).fillColor("#C58A1F").text(label);
    doc.moveDown(0.15);
    doc.font(FONT_REGULAR).fontSize(9).fillColor("#1F2937").text(value, { width: 495 });
    doc.moveDown(0.6);
  });
  doc.moveDown(0.5);
  doc.font(FONT_REGULAR).fontSize(7).fillColor("#B71C1C").text(CONFIDENTIALITY_NOTICE, { width: 495 });
}

function collectPdfKitBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

async function pdfkitPageToMerged(merged, drawFn) {
  const d = new PDFDocument({ margin: 50 });
  const bufferPromise = collectPdfKitBuffer(d);
  drawFn(d);
  d.end();
  const buffer = await bufferPromise;
  const srcPdf = await PdfLibDocument.load(buffer);
  const pages = await merged.copyPages(srcPdf, srcPdf.getPageIndices());
  pages.forEach((p) => merged.addPage(p));
}

async function mergeRealPdfPages(merged, pdfBuffer, label) {
  try {
    const srcPdf = await PdfLibDocument.load(pdfBuffer, { ignoreEncryption: true });
    const pages = await merged.copyPages(srcPdf, srcPdf.getPageIndices());
    pages.forEach((p) => merged.addPage(p));
  } catch (e) {
    console.error(`Failed to merge PDF (${label}) into brochure:`, e.message);
  }
}

// Builds one product's full brochure section as PDF bytes: the info card,
// PIL pages, Visual Aid slides (image + talk-track), Promo materials
// (image or full PDF + audience/talk-track details), and Scientific info.
async function buildProductBrochureBuffer(productId) {
  const data = await loadPortfolioDetail(productId);
  const filesRes = await pool.query("select * from product_files where product_id=$1 order by created_at desc", [productId]);
  const files = filesRes.rows;
  const vaRes = await pool.query("select * from product_visual_aids where product_id=$1 order by sort_order, created_at", [productId]);
  const pmRes = await pool.query("select * from product_promo_materials where product_id=$1 order by sort_order, created_at", [productId]);
  const siRes = await pool.query("select * from product_scientific_info where product_id=$1 order by created_at", [productId]);

  const merged = await PdfLibDocument.create();

  // 1. Info card
  await pdfkitPageToMerged(merged, (d) => drawBrochurePage(d, data, files));

  // 2. PIL — merge real pages if PDF
  for (const f of files) {
    if (f.mime_type === "application/pdf") await mergeRealPdfPages(merged, f.file_data, `PIL #${f.id}`);
  }

  // 3. Visual Aid slides — image + 4 fields, one page each
  for (const va of vaRes.rows) {
    await pdfkitPageToMerged(merged, (d) => drawImageWithFieldsPage(d, va.image_data, va.image_mime, `Visual Aid: ${va.image_name}`, [
      ["Содержание слайда", va.content_desc],
      ["Цель слайда", va.purpose],
      ["Детализация", va.detail_script],
      ["Комментарии", va.comments],
    ]));
  }

  // 4. Promo materials — image+fields page, or details page + real PDF pages
  for (const pm of pmRes.rows) {
    const fields = [
      ["Тип материала", pm.material_type],
      ["Целевая аудитория", (pm.target_audience || []).join(", ")],
      ["Содержание материала", pm.content_desc],
      ["Цель материала", pm.purpose],
      ["Детализация", pm.detail_script],
      ["Комментарии", pm.comments],
    ];
    if (pm.file_mime === "application/pdf") {
      await pdfkitPageToMerged(merged, (d) => drawTextOnlyDetailsPage(d, `Промо материал: ${pm.material_name}`, fields));
      await mergeRealPdfPages(merged, pm.file_data, `promo #${pm.id}`);
    } else {
      await pdfkitPageToMerged(merged, (d) => drawImageWithFieldsPage(d, pm.file_data, pm.file_mime, `Промо материал: ${pm.material_name}`, fields));
    }
  }

  // 5. Scientific info
  for (const si of siRes.rows) {
    if (si.file_mime === "application/pdf") {
      await pdfkitPageToMerged(merged, (d) => drawTextOnlyDetailsPage(d, `Научная информация: ${si.title}`, [["Комментарии", si.comments]]));
      await mergeRealPdfPages(merged, si.file_data, `sci #${si.id}`);
    } else if (si.file_mime.startsWith("image/")) {
      await pdfkitPageToMerged(merged, (d) => drawImageWithFieldsPage(d, si.file_data, si.file_mime, `Научная информация: ${si.title}`, [["Комментарии", si.comments]]));
    } else {
      await pdfkitPageToMerged(merged, (d) => drawTextOnlyDetailsPage(d, `Научная информация: ${si.title}`, [
        ["Формат", si.file_mime],
        ["Примечание", "Файл доступен для скачивания отдельно в системе (не может быть встроен в PDF)"],
        ["Комментарии", si.comments],
      ]));
    }
  }

  return Buffer.from(await merged.save());
}

async function loadPortfolioDetail(productId) {
  const pRes = await pool.query(`select p.*, g.name as group_name from products p left join groups g on g.id=p.group_id where p.id=$1`, [productId]);
  if (!pRes.rows[0]) return null;
  const compRes = await pool.query("select * from product_competitors where product_id=$1 order by is_direct desc, competitor_name", [productId]);
  const prices = compRes.rows.filter((c) => c.competitor_price_usd != null).map((c) => Number(c.competitor_price_usd));
  const avg = prices.length ? prices.reduce((s, x) => s + x, 0) / prices.length : null;
  return { product: pRes.rows[0], competitors: compRes.rows, avg_competitor_price_usd: avg };
}

app.get("/api/portfolio/:id/brochure.pdf", auth, async (req, res) => {
  const { id } = req.params;
  const scope = await portfolioScope(req.user, 2);
  const check = await pool.query(`select p.id from products p where p.id=$1 and p.is_active=true and (${scope.where})`, [id, ...scope.values]);
  if (!check.rows[0]) return res.status(403).json({ error: "Forbidden" });
  const buffer = await buildProductBrochureBuffer(id);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="portfolio_${id}.pdf"`);
  res.end(buffer);
});

app.get("/api/portfolio-brochure.pdf", auth, async (req, res) => {
  const scope = await portfolioScope(req.user);
  const listRes = await pool.query(`select p.id from products p where p.is_active=true and ${scope.where} order by p.sort_order, p.name`, scope.values);

  const merged = await PdfLibDocument.create();

  const coverDoc = new PDFDocument({ margin: 50 });
  const coverBufferPromise = collectPdfKitBuffer(coverDoc);
  coverDoc.font(FONT_BOLD).fontSize(24).fillColor("#1F2937").text("PULSE — Портфолио препаратов", { align: "center" });
  coverDoc.moveDown(2);
  coverDoc.font(FONT_REGULAR).fontSize(9).fillColor("#B71C1C").text(CONFIDENTIALITY_NOTICE, { align: "center" });
  coverDoc.end();
  const coverPdf = await PdfLibDocument.load(await coverBufferPromise);
  (await merged.copyPages(coverPdf, coverPdf.getPageIndices())).forEach((p) => merged.addPage(p));

  for (const row of listRes.rows) {
    const productBuffer = await buildProductBrochureBuffer(row.id);
    const productPdf = await PdfLibDocument.load(productBuffer);
    (await merged.copyPages(productPdf, productPdf.getPageIndices())).forEach((p) => merged.addPage(p));
  }

  const finalBuffer = Buffer.from(await merged.save());
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="PULSE_portfolio_brochure.pdf"`);
  res.end(finalBuffer);
});

/* ============================================================
   NAVI — AI visit-prep assistant. MP maintains a doctor card;
   NAVI analyzes the profile + full visit history and gives
   concrete tactics for today's visit, in the MP's current UI
   language. No setup needed by the MP — same server-side
   ANTHROPIC_API_KEY as the "NAVI" analytics tab.
   ============================================================ */
async function naviDoctorScope(user) {
  if (user.role === "master") return { where: "1=1", values: [] };
  if (user.role === "mp") return { where: "d.territory = (select territory from users where id = $1)", values: [user.id] };
  if (user.role === "rm") return { where: "d.territory in (select territory from users where rm_id = $1 and role='mp' and territory is not null)", values: [user.id] };
  if (user.role === "bm") return { where: "d.territory in (select territory from users where group_id = $1 and role='mp' and territory is not null)", values: [user.group_id] };
  return { where: "1=0", values: [] };
}

app.get("/api/navi/doctors", auth, async (req, res) => {
  const { search } = req.query;
  const scope = await naviDoctorScope(req.user);
  const params = [...scope.values];
  let where = `(${scope.where})`;
  if (search && search.trim()) {
    params.push(`%${search.trim().toLowerCase()}%`);
    where += ` and (lower(d.last_name) like $${params.length} or lower(coalesce(d.first_name,'')) like $${params.length} or lower(coalesce(d.lpu,'')) like $${params.length} or lower(coalesce(d.city,'')) like $${params.length})`;
  }
  const { rows } = await pool.query(
    `select d.*, mp.full_name as mp_name,
            (select count(*) from navi_visits v where v.doctor_id=d.id) as visit_count
     from navi_doctors d left join users mp on mp.id=d.mp_id
     where ${where} order by d.last_name`,
    params
  );
  res.json(rows);
});

app.post("/api/navi/doctors", auth, requireRole("mp"), async (req, res) => {
  const { last_name, first_name, patronymic, city, lpu, specialty, experience_years, psychotype, visit_minutes, needs, behavior, products } = req.body;
  if (!last_name || !last_name.trim()) return res.status(400).json({ error: "Укажите фамилию врача" });
  const { rows } = await pool.query(
    `insert into navi_doctors (mp_id, territory, last_name, first_name, patronymic, city, lpu, specialty, experience_years, psychotype, visit_minutes, needs, behavior)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
    [req.user.id, req.user.territory || null, last_name.trim(), first_name || "", patronymic || "", city || "", lpu || "", specialty || "", experience_years || null, psychotype || "", visit_minutes || null, needs || "", behavior || ""]
  );
  const doctor = rows[0];
  for (const p of (products || [])) {
    if (!p.product_id) continue;
    await pool.query("insert into navi_doctor_products (doctor_id, product_id, prescriptions) values ($1,$2,$3)", [doctor.id, p.product_id, p.prescriptions || 0]);
  }
  res.json(doctor);
});

async function canAccessNaviDoctor(user, doctorId) {
  const r = await pool.query(`select territory from navi_doctors where id=$1`, [doctorId]);
  const row = r.rows[0];
  if (!row) return false;
  if (user.role === "master") return true;
  if (!row.territory) return false;
  if (user.role === "mp") return row.territory === user.territory;
  if (user.role === "rm") {
    const t = await pool.query("select 1 from users where rm_id=$1 and role='mp' and territory=$2", [user.id, row.territory]);
    return t.rows.length > 0;
  }
  if (user.role === "bm") {
    const t = await pool.query("select 1 from users where group_id=$1 and role='mp' and territory=$2", [user.group_id, row.territory]);
    return t.rows.length > 0;
  }
  return false;
}

app.get("/api/navi/doctors/:id", auth, async (req, res) => {
  const { id } = req.params;
  if (!(await canAccessNaviDoctor(req.user, id))) return res.status(403).json({ error: "Forbidden" });
  const dRes = await pool.query(`select d.*, mp.full_name as mp_name from navi_doctors d left join users mp on mp.id=d.mp_id where d.id=$1`, [id]);
  const productsRes = await pool.query(
    `select dp.*, p.name as product_name from navi_doctor_products dp join products p on p.id=dp.product_id where dp.doctor_id=$1`, [id]
  );
  const visitsRes = await pool.query(
    `select v.*, pm.file_mime = 'application/pdf' as promo_material_is_pdf
     from navi_visits v left join product_promo_materials pm on pm.id=v.promo_material_id
     where v.doctor_id=$1 order by v.created_at desc`, [id]
  );
  const canEdit = req.user.role === "mp" && !!req.user.territory && dRes.rows[0].territory === req.user.territory;
  res.json({ doctor: dRes.rows[0], products: productsRes.rows, visits: visitsRes.rows, can_edit: canEdit });
});

app.put("/api/navi/doctors/:id", auth, requireRole("mp"), async (req, res) => {
  const { id } = req.params;
  const check = await pool.query("select territory from navi_doctors where id=$1", [id]);
  if (!check.rows[0] || !req.user.territory || check.rows[0].territory !== req.user.territory) return res.status(403).json({ error: "Forbidden" });
  const { last_name, first_name, patronymic, city, lpu, specialty, experience_years, psychotype, visit_minutes, needs, behavior, products } = req.body;
  await pool.query(
    `update navi_doctors set last_name=coalesce($1,last_name), first_name=coalesce($2,first_name), patronymic=coalesce($3,patronymic),
     city=coalesce($4,city), lpu=coalesce($5,lpu), specialty=coalesce($6,specialty), experience_years=coalesce($7,experience_years),
     psychotype=coalesce($8,psychotype), visit_minutes=coalesce($9,visit_minutes), needs=coalesce($10,needs), behavior=coalesce($11,behavior), updated_at=now()
     where id=$12`,
    [last_name, first_name, patronymic, city, lpu, specialty, experience_years, psychotype, visit_minutes, needs, behavior, id]
  );
  if (products) {
    await pool.query("delete from navi_doctor_products where doctor_id=$1", [id]);
    for (const p of products) {
      if (!p.product_id) continue;
      await pool.query("insert into navi_doctor_products (doctor_id, product_id, prescriptions) values ($1,$2,$3)", [id, p.product_id, p.prescriptions || 0]);
    }
  }
  res.json({ ok: true });
});

app.delete("/api/navi/doctors/:id", auth, requireRole("mp"), async (req, res) => {
  const { id } = req.params;
  const check = await pool.query("select territory from navi_doctors where id=$1", [id]);
  if (!check.rows[0] || !req.user.territory || check.rows[0].territory !== req.user.territory) return res.status(403).json({ error: "Forbidden" });
  await pool.query("delete from navi_doctors where id=$1", [id]);
  res.json({ ok: true });
});

app.post("/api/navi/doctors/:id/start-visit", auth, requireRole("mp"), async (req, res) => {
  if (!aiEnabled) return res.status(503).json({ error: "NAVI не настроен на сервере (нет ANTHROPIC_API_KEY)" });
  const { id } = req.params;
  const { lang, visit_goal, products } = req.body;
  const check = await pool.query("select territory from navi_doctors where id=$1", [id]);
  if (!check.rows[0] || !req.user.territory || check.rows[0].territory !== req.user.territory) return res.status(403).json({ error: "Forbidden" });

  const dRes = await pool.query("select * from navi_doctors where id=$1", [id]);
  const historicalPrescriptionsRes = await pool.query(
    `select dp.product_id, p.name as product_name, dp.prescriptions from navi_doctor_products dp join products p on p.id=dp.product_id where dp.doctor_id=$1`, [id]
  );
  const visitsRes = await pool.query(
    "select visit_date, visit_goal, visit_products, ai_sections, mp_report, post_visit_brands, post_visit_agreements from navi_visits where doctor_id=$1 and mp_report is not null order by created_at asc", [id]
  );

  const visitProducts = Array.isArray(products) ? products : [];
  const productIds = visitProducts.map((p) => p.product_id).filter(Boolean);
  const nameByProductId = Object.fromEntries(historicalPrescriptionsRes.rows.map((r) => [r.product_id, r.product_name]));
  if (productIds.length) {
    const namesRes = await pool.query("select id, name from products where id = any($1::bigint[])", [productIds]);
    for (const r of namesRes.rows) nameByProductId[r.id] = r.name;
  }

  // Portfolio materials available for this visit's brands, scoped to the MP's group
  let availableVisualAids = [], availablePromoMaterials = [];
  if (productIds.length) {
    const vaRes = await pool.query(
      `select va.id, va.image_name, va.content_desc, va.purpose, va.detail_script, p.name as product_name
       from product_visual_aids va join products p on p.id=va.product_id
       where va.product_id = any($1::bigint[]) and p.group_id=$2`,
      [productIds, req.user.group_id]
    );
    availableVisualAids = vaRes.rows;
    const pmRes = await pool.query(
      `select pm.id, pm.material_name, pm.material_type, pm.target_audience, pm.content_desc, pm.purpose, pm.detail_script, p.name as product_name
       from product_promo_materials pm join products p on p.id=pm.product_id
       where pm.product_id = any($1::bigint[]) and p.group_id=$2`,
      [productIds, req.user.group_id]
    );
    availablePromoMaterials = pmRes.rows;
  }

  const context = {
    doctor: {
      specialty: dRes.rows[0].specialty, experience_years: dRes.rows[0].experience_years, psychotype: dRes.rows[0].psychotype,
      visit_minutes: dRes.rows[0].visit_minutes, needs: dRes.rows[0].needs, behavior: dRes.rows[0].behavior, city: dRes.rows[0].city, lpu: dRes.rows[0].lpu,
    },
    visit_goal: visit_goal || "",
    visit_plan_by_brand: visitProducts.map((p) => ({
      brand: nameByProductId[p.product_id] || "—",
      current_rx_per_week: p.current_rx_per_week ?? null,
      doctor_potential_per_week: p.potential_per_week ?? null,
      competitors: (p.competitors || []).map((c) => ({ name: c.name, rx_per_week: c.rx_per_week })),
      target_rx_per_week_for_this_visit: p.target_rx_per_week ?? null,
    })),
    past_visits: visitsRes.rows.map((v) => ({
      date: v.visit_date, goal_was: v.visit_goal, plan_was: v.visit_products, navi_advised: v.ai_sections,
      mp_report_text: v.mp_report, actual_monthly_by_brand: v.post_visit_brands, agreements_made: v.post_visit_agreements,
    })),
    available_visual_aids: availableVisualAids.map((va) => ({ id: va.id, brand: va.product_name, name: va.image_name, content: va.content_desc, purpose: va.purpose, script: va.detail_script })),
    available_promo_materials: availablePromoMaterials.map((pm) => ({ id: pm.id, brand: pm.product_name, name: pm.material_name, type: pm.material_type, audience: pm.target_audience, content: pm.content_desc, purpose: pm.purpose, script: pm.detail_script })),
  };

  let sections;
  try {
    sections = await callClaudeForNavi(context, lang === "uz" ? "uz" : "ru");
  } catch (e) {
    console.error("NAVI error:", e.message);
    return res.status(502).json({ error: "Не удалось получить рекомендацию от NAVI. Попробуйте позже." });
  }

  // Guard: only accept material ids that were actually offered to the model
  const validVaIds = new Set(availableVisualAids.map((v) => Number(v.id)));
  const validPmIds = new Set(availablePromoMaterials.map((v) => Number(v.id)));
  const aiVaId = sections.visual_aid_id != null ? Number(sections.visual_aid_id) : null;
  const aiPmId = sections.promo_material_id != null ? Number(sections.promo_material_id) : null;
  const visualAidId = aiVaId !== null && validVaIds.has(aiVaId) ? aiVaId : null;
  const promoMaterialId = aiPmId !== null && validPmIds.has(aiPmId) ? aiPmId : null;

  const { rows } = await pool.query(
    `insert into navi_visits (doctor_id, ai_recommendation, ai_lang, visit_goal, visit_products, ai_sections, visual_aid_id, promo_material_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
    [id, sections.general_recommendations || "", lang === "uz" ? "uz" : "ru", visit_goal || "", visitProducts, sections, visualAidId, promoMaterialId]
  );
  res.json(rows[0]);
});

app.put("/api/navi/visits/:id", auth, requireRole("mp"), async (req, res) => {
  const { id } = req.params;
  const check = await pool.query(
    `select v.id, d.territory from navi_visits v join navi_doctors d on d.id=v.doctor_id where v.id=$1`, [id]
  );
  if (!check.rows[0] || !req.user.territory || check.rows[0].territory !== req.user.territory) return res.status(403).json({ error: "Forbidden" });
  const { mp_report, post_visit_brands, post_visit_agreements } = req.body;
  await pool.query(
    "update navi_visits set mp_report=$1, post_visit_brands=$2, post_visit_agreements=$3, reported_at=now() where id=$4",
    [mp_report || "", post_visit_brands || [], post_visit_agreements || [], id]
  );
  // Keep the doctor's "already prescribes" reference numbers current for next visit's auto-fill
  const doctorRes = await pool.query("select doctor_id from navi_visits where id=$1", [id]);
  const doctorId = doctorRes.rows[0].doctor_id;
  for (const b of (post_visit_brands || [])) {
    if (!b.product_id) continue;
    await pool.query(
      `insert into navi_doctor_products (doctor_id, product_id, prescriptions) values ($1,$2,$3)
       on conflict (doctor_id, product_id) do update set prescriptions=excluded.prescriptions`,
      [doctorId, b.product_id, b.monthly_qty || 0]
    );
  }
  res.json({ ok: true });
});

/* ============================================================
   MARKETING EVENTS & ACTIVITIES — BM defines typed templates per
   group (bilingual name + monthly/quarterly target); MPs in that
   group plan instances up to 3 months ahead and later report the
   actual result. Same workflow for "event" and "activity" kinds.
   ============================================================ */
async function activityTypeScope(user) {
  if (user.role === "master") return { where: "1=1", values: [] };
  if (user.role === "mp" || user.role === "bm") return { where: "t.group_id = $1", values: [user.group_id] };
  if (user.role === "rm") {
    return { where: `t.group_id in (select distinct group_id from users where rm_id = $1 and group_id is not null)`, values: [user.id] };
  }
  return { where: "1=0", values: [] };
}
async function activityEntryScope(user) {
  if (user.role === "master") return { where: "1=1", values: [] };
  if (user.role === "mp") return { where: "e.mp_id = $1", values: [user.id] };
  if (user.role === "rm") return { where: "mp.rm_id = $1", values: [user.id] };
  if (user.role === "bm") return { where: "mp.group_id = $1", values: [user.group_id] };
  return { where: "1=0", values: [] };
}
function canEditActivityType(user, groupId) {
  if (user.role === "master") return true;
  if (user.role === "bm") return user.group_id === groupId;
  return false;
}

app.get("/api/activity-types", auth, async (req, res) => {
  const { category } = req.query;
  const scope = await activityTypeScope(req.user);
  const params = [...scope.values];
  let where = `t.is_active=true and (${scope.where})`;
  if (category) { params.push(category); where += ` and t.category = $${params.length}`; }
  const { rows } = await pool.query(
    `select t.*, g.name as group_name from activity_types t join groups g on g.id=t.group_id where ${where} order by t.name`,
    params
  );
  res.json(rows);
});

app.post("/api/activity-types", auth, requireRole("master", "bm"), async (req, res) => {
  const { category, name, name_uz, monthly_target, quarterly_target, group_id } = req.body;
  if (!["event", "activity"].includes(category)) return res.status(400).json({ error: "Неверная категория" });
  if (!name || !name.trim()) return res.status(400).json({ error: "Укажите название" });
  const gid = req.user.role === "bm" ? req.user.group_id : group_id;
  if (!gid) return res.status(400).json({ error: "Укажите группу" });
  const { rows } = await pool.query(
    `insert into activity_types (group_id, category, name, name_uz, monthly_target, quarterly_target, created_by)
     values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [gid, category, name.trim(), name_uz || null, monthly_target || 0, quarterly_target || 0, req.user.id]
  );
  res.json(rows[0]);
});

app.put("/api/activity-types/:id", auth, requireRole("master", "bm"), async (req, res) => {
  const { id } = req.params;
  const tRes = await pool.query("select group_id from activity_types where id=$1", [id]);
  if (!tRes.rows[0] || !canEditActivityType(req.user, tRes.rows[0].group_id)) return res.status(403).json({ error: "Forbidden" });
  const { name, name_uz, monthly_target, quarterly_target } = req.body;
  await pool.query(
    `update activity_types set name=coalesce($1,name), name_uz=coalesce($2,name_uz),
     monthly_target=coalesce($3,monthly_target), quarterly_target=coalesce($4,quarterly_target) where id=$5`,
    [name, name_uz, monthly_target, quarterly_target, id]
  );
  res.json({ ok: true });
});

app.delete("/api/activity-types/:id", auth, requireRole("master", "bm"), async (req, res) => {
  const { id } = req.params;
  const tRes = await pool.query("select group_id from activity_types where id=$1", [id]);
  if (!tRes.rows[0] || !canEditActivityType(req.user, tRes.rows[0].group_id)) return res.status(403).json({ error: "Forbidden" });
  await pool.query("update activity_types set is_active=false where id=$1", [id]);
  res.json({ ok: true });
});

app.get("/api/activity-entries", auth, async (req, res) => {
  const { category, mp_id, year, month } = req.query;
  const scope = await activityEntryScope(req.user);
  const params = [...scope.values];
  let where = `(${scope.where})`;
  if (category) { params.push(category); where += ` and t.category = $${params.length}`; }
  if (mp_id) { params.push(mp_id); where += ` and e.mp_id = $${params.length}`; }
  if (year) { params.push(year); where += ` and e.period_year = $${params.length}`; }
  if (month) { params.push(month); where += ` and e.period_month = $${params.length}`; }
  const { rows } = await pool.query(
    `select e.*, t.name as type_name, t.name_uz as type_name_uz, t.category as kind_category, mp.full_name as mp_name
     from activity_entries e
     join activity_types t on t.id = e.activity_type_id
     join users mp on mp.id = e.mp_id
     where ${where}
     order by e.planned_date desc`,
    params
  );
  res.json(rows);
});

app.post("/api/activity-entries", auth, requireRole("mp"), async (req, res) => {
  const { activity_type_id, planned_date, city, venue, participants_count, participant_names, comments } = req.body;
  if (!activity_type_id || !planned_date) return res.status(400).json({ error: "Укажите тип и дату" });
  const d = new Date(planned_date);
  const { rows } = await pool.query(
    `insert into activity_entries (activity_type_id, mp_id, period_year, period_month, planned_date, city, venue, participants_count, participant_names, comments)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
    [activity_type_id, req.user.id, d.getFullYear(), d.getMonth() + 1, planned_date, city || null, venue || null, participants_count || null, participant_names || null, comments || null]
  );
  res.json(rows[0]);
});

app.put("/api/activity-entries/:id", auth, requireRole("mp"), async (req, res) => {
  const { id } = req.params;
  const check = await pool.query("select mp_id from activity_entries where id=$1", [id]);
  if (!check.rows[0] || check.rows[0].mp_id !== req.user.id) return res.status(403).json({ error: "Forbidden" });
  const { planned_date, city, venue, participants_count, participant_names, comments,
          actual_date, actual_participants_count, actual_participant_names, actual_comments, status } = req.body;
  await pool.query(
    `update activity_entries set
       planned_date=coalesce($1,planned_date), city=coalesce($2,city), venue=coalesce($3,venue),
       participants_count=coalesce($4,participants_count), participant_names=coalesce($5,participant_names), comments=coalesce($6,comments),
       actual_date=coalesce($7,actual_date), actual_participants_count=coalesce($8,actual_participants_count),
       actual_participant_names=coalesce($9,actual_participant_names), actual_comments=coalesce($10,actual_comments),
       status=coalesce($11,status)
     where id=$12`,
    [planned_date, city, venue, participants_count, participant_names, comments,
     actual_date, actual_participants_count, actual_participant_names, actual_comments, status, id]
  );
  res.json({ ok: true });
});

app.delete("/api/activity-entries/:id", auth, requireRole("mp"), async (req, res) => {
  const { id } = req.params;
  const check = await pool.query("select mp_id, status from activity_entries where id=$1", [id]);
  if (!check.rows[0] || check.rows[0].mp_id !== req.user.id) return res.status(403).json({ error: "Forbidden" });
  if (check.rows[0].status === "completed") return res.status(400).json({ error: "Нельзя удалить уже завершённую запись" });
  await pool.query("delete from activity_entries where id=$1", [id]);
  res.json({ ok: true });
});

// Auto-generated monthly report: planned vs completed count per type + achievement %
app.get("/api/activity-report", auth, async (req, res) => {
  const { year, month, mp_id } = req.query;
  if (!year || !month) return res.status(400).json({ error: "Укажите год и месяц" });
  const scope = await activityEntryScope(req.user);
  const params = [...scope.values, year, month];
  let where = `(${scope.where}) and e.period_year=$${params.length - 1} and e.period_month=$${params.length}`;
  if (mp_id) { params.push(mp_id); where += ` and e.mp_id=$${params.length}`; }
  const { rows } = await pool.query(
    `select e.*, t.name as type_name, t.name_uz as type_name_uz, t.category as kind_category, t.monthly_target, mp.full_name as mp_name
     from activity_entries e join activity_types t on t.id=e.activity_type_id join users mp on mp.id=e.mp_id
     where ${where}`,
    params
  );
  const byType = {};
  for (const r of rows) {
    const key = r.activity_type_id;
    byType[key] ||= { type_name: r.type_name, type_name_uz: r.type_name_uz, category: r.kind_category, monthly_target: r.monthly_target, planned: 0, completed: 0, entries: [] };
    byType[key].planned += 1;
    if (r.status === "completed") byType[key].completed += 1;
    byType[key].entries.push(r);
  }
  const summary = Object.values(byType).map((t) => ({ ...t, achievement: t.monthly_target ? t.completed / t.monthly_target : null }));
  res.json({ summary, entries: rows });
});

/* ============================================================
   BULK IMPORT — master uploads the monthly FSS workbook or the
   annual Target workbook; data is distributed to MPs by territory.
   ============================================================ */
function normTerritory(s) { return String(s || "").trim().toLowerCase(); }

app.post("/api/import/fss", auth, requireRole("master"), upload.single("file"), async (req, res) => {
  const { year, month } = req.body;
  if (!req.file) return res.status(400).json({ error: "Файл не получен" });
  if (!year || !month) return res.status(400).json({ error: "Укажите год и месяц" });

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(req.file.buffer);
  const productsRes = await pool.query("select id, name from products order by sort_order");
  const { byTerritory, unmatchedProducts, missingAreas } = parseFssWorkbook(wb, productsRes.rows);

  const usersRes = await pool.query("select id, full_name, territory from users where role='mp' and is_active=true");

  let mpUpdated = 0;
  const noMpForTerritory = [];
  const changes = [];
  for (const t of TERRITORIES) {
    const data = byTerritory[t.key];
    if (!data) continue;
    const mps = usersRes.rows.filter((u) => normTerritory(u.territory) === normTerritory(t.label));
    if (mps.length === 0) { noMpForTerritory.push(t.label); continue; }
    for (const mp of mps) {
      const report = await getOrCreateReport(mp.id, Number(year), Number(month));
      for (const [productId, qty] of Object.entries(data)) {
        const oldRes = await pool.query("select actual_qty from report_fss where report_id=$1 and product_id=$2", [report.id, productId]);
        const oldVal = oldRes.rows[0]?.actual_qty;
        if (Number(oldVal) !== Number(qty)) {
          changes.push({ report_id: report.id, product_id: Number(productId), field: "actual_qty", old_value: oldVal, new_value: qty });
        }
        await pool.query("update report_fss set actual_qty=$1 where report_id=$2 and product_id=$3", [qty, report.id, productId]);
      }
      mpUpdated++;
    }
  }

  const summary = { mp_updated: mpUpdated, unmatched_products: unmatchedProducts, missing_areas: missingAreas, no_mp_for_territory: noMpForTerritory };
  let importId = null;
  try {
    const logRes = await pool.query(
      "insert into import_log (import_type, period_year, period_month, uploaded_by, summary, changes) values ('fss',$1,$2,$3,$4,$5) returning id",
      [year, month, req.user.id, summary, changes]
    );
    importId = logRes.rows[0].id;
    // A re-upload of the same month's FSS data becomes the source of truth —
    // supersede earlier active imports for that exact month so they can't be
    // mistakenly "cancelled" later and roll current data back to stale values.
    await pool.query(
      "update import_log set superseded_by=$1 where import_type='fss' and period_year=$2 and period_month=$3 and id != $1 and reverted=false and superseded_by is null",
      [importId, year, month]
    );
  } catch (e) {
    console.error("import_log insert failed (FSS import itself already succeeded):", e.message);
  }
  res.json({ ...summary, import_id: importId });
});

app.post("/api/import/targets", auth, requireRole("master"), upload.single("file"), async (req, res) => {
  const { fy } = req.body;
  if (!req.file) return res.status(400).json({ error: "Файл не получен" });
  if (!fy) return res.status(400).json({ error: "Укажите финансовый год (например, 27)" });

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(req.file.buffer);
  const productsRes = await pool.query("select id, name from products order by sort_order");
  const { byTerritory, unmatchedProducts, missingSheets } = parseTargetsWorkbook(wb, productsRes.rows);

  const usersRes = await pool.query("select id, full_name, territory from users where role='mp' and is_active=true");

  let mpUpdated = 0;
  const noMpForTerritory = [];
  const changes = [];
  for (const t of TERRITORIES) {
    const perProduct = byTerritory[t.key];
    if (!perProduct) continue;
    const mps = usersRes.rows.filter((u) => normTerritory(u.territory) === normTerritory(t.label));
    if (mps.length === 0) { noMpForTerritory.push(t.label); continue; }
    for (const mp of mps) {
      for (let month = 1; month <= 12; month++) {
        const calYear = monthToCalendarYear(month, Number(fy));
        const report = await getOrCreateReport(mp.id, calYear, month);
        for (const [productId, monthly] of Object.entries(perProduct)) {
          const newVal = monthly[month] || 0;
          const oldRes = await pool.query("select target_qty from report_fss where report_id=$1 and product_id=$2", [report.id, productId]);
          const oldVal = oldRes.rows[0]?.target_qty;
          if (Number(oldVal) !== Number(newVal)) {
            changes.push({ report_id: report.id, product_id: Number(productId), field: "target_qty", old_value: oldVal, new_value: newVal });
          }
          await pool.query("update report_fss set target_qty=$1 where report_id=$2 and product_id=$3", [newVal, report.id, productId]);
        }
      }
      mpUpdated++;
    }
  }

  const summary = { mp_updated: mpUpdated, unmatched_products: unmatchedProducts, missing_sheets: missingSheets, no_mp_for_territory: noMpForTerritory };
  let importId = null;
  try {
    const periodYear = 1999 + Number(fy);
    const logRes = await pool.query(
      "insert into import_log (import_type, period_year, uploaded_by, summary, changes) values ('targets',$1,$2,$3,$4) returning id",
      [periodYear, req.user.id, summary, changes]
    );
    importId = logRes.rows[0].id;
    // This new targets file is now the source of truth for the whole fiscal year —
    // mark every earlier, still-active targets import for that year as superseded,
    // so nobody can accidentally "cancel" an old one and corrupt the current data.
    await pool.query(
      "update import_log set superseded_by=$1 where import_type='targets' and period_year=$2 and id != $1 and reverted=false and superseded_by is null",
      [importId, periodYear]
    );
  } catch (e) {
    console.error("import_log insert failed (targets import itself already succeeded):", e.message);
  }
  res.json({ ...summary, import_id: importId });
});

/* ---- Import history: list + undo ---- */
app.get("/api/import/history", auth, requireRole("master"), async (req, res) => {
  const { rows } = await pool.query(
    `select l.id, l.import_type, l.period_year, l.period_month, l.summary, l.reverted, l.superseded_by, l.created_at, u.full_name as uploaded_by_name
     from import_log l join users u on u.id = l.uploaded_by order by l.created_at desc limit 50`
  );
  res.json(rows);
});

app.post("/api/import/:id/undo", auth, requireRole("master"), async (req, res) => {
  const { id } = req.params;
  const logRes = await pool.query("select * from import_log where id=$1", [id]);
  const log = logRes.rows[0];
  if (!log) return res.status(404).json({ error: "Импорт не найден" });
  if (log.reverted) return res.status(409).json({ error: "Уже отменено" });
  if (log.superseded_by) return res.status(409).json({ error: "Эта загрузка уже заменена более новой — отмена невозможна, так как отменит корректные актуальные данные" });
  const changes = log.changes || [];
  for (const c of changes) {
    await pool.query(`update report_fss set ${c.field}=$1 where report_id=$2 and product_id=$3`, [c.old_value || 0, c.report_id, c.product_id]);
  }
  await pool.query("update import_log set reverted=true where id=$1", [id]);
  res.json({ ok: true, reverted_cells: changes.length });
});

app.delete("/api/import/:id", auth, requireRole("master"), async (req, res) => {
  const { id } = req.params;
  const check = await pool.query("select id from import_log where id=$1", [id]);
  if (!check.rows[0]) return res.status(404).json({ error: "Импорт не найден" });
  // Clear the "superseded_by" pointer on any older entry that referenced this one,
  // so deleting a record never leaves a dangling reference behind.
  await pool.query("update import_log set superseded_by=null where superseded_by=$1", [id]);
  await pool.query("delete from import_log where id=$1", [id]);
  res.json({ ok: true });
});

/* Tile-friendly status: the single currently-active targets import (if any),
   and one FSS status slot per month of the given year. "Active" means not
   reverted and not superseded — i.e. genuinely the current source of truth. */
app.get("/api/import/status", auth, requireRole("master"), async (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();

  const targetsRes = await pool.query(
    `select l.id, l.period_year, l.summary, l.created_at, u.full_name as uploaded_by_name
     from import_log l join users u on u.id=l.uploaded_by
     where l.import_type='targets' and l.reverted=false and l.superseded_by is null
     order by l.created_at desc`
  );

  const fssRes = await pool.query(
    `select l.id, l.period_year, l.period_month, l.summary, l.created_at, u.full_name as uploaded_by_name
     from import_log l join users u on u.id=l.uploaded_by
     where l.import_type='fss' and l.period_year=$1 and l.reverted=false and l.superseded_by is null
     order by l.period_month`,
    [year]
  );
  const fssByMonth = {};
  for (const r of fssRes.rows) fssByMonth[r.period_month] = r;

  res.json({
    targets: targetsRes.rows,
    fss_year: year,
    fss_by_month: fssByMonth,
  });
});

/* ============================================================
   REPORTS — list (role-scoped)
   ============================================================ */
app.get("/api/reports", auth, async (req, res) => {
  const { year, month } = req.query;
  let where = [];
  let values = [];
  let i = 1;

  if (req.user.role === "mp") {
    where.push(`r.mp_id = $${i++}`);
    values.push(req.user.id);
  } else if (req.user.role === "rm") {
    where.push(`mp.rm_id = $${i++}`);
    values.push(req.user.id);
    where.push(`r.status != 'draft'`); // RM only sees reports the MP has actually submitted for review
  } else if (req.user.role === "master") {
    where.push(`r.status != 'draft'`); // hide unfinished drafts from the master list too
  } else if (req.user.role === "bm") {
    where.push(`mp.group_id = $${i++}`);
    values.push(req.user.group_id);
    where.push(`r.status = 'approved'`);
  }

  if (year) { where.push(`r.period_year = $${i++}`); values.push(year); }
  if (month) { where.push(`r.period_month = $${i++}`); values.push(month); }

  const sql = `
    select r.*, mp.full_name as mp_name, mp.territory as mp_territory, mp.rm_id,
           rm.full_name as rm_name
    from reports r
    join users mp on mp.id = r.mp_id
    left join users rm on rm.id = mp.rm_id
    ${where.length ? "where " + where.join(" and ") : ""}
    order by r.period_year desc, r.period_month desc, mp.full_name`;
  const { rows } = await pool.query(sql, values);
  res.json(rows);
});

// get-or-create current MP's report for a period
async function getOrCreateReport(mpId, periodYear, periodMonth) {
  let { rows } = await pool.query(
    "select * from reports where mp_id=$1 and period_year=$2 and period_month=$3",
    [mpId, periodYear, periodMonth]
  );
  if (rows[0]) return rows[0];

  const created = await pool.query(
    "insert into reports (mp_id, period_year, period_month) values ($1,$2,$3) returning *",
    [mpId, periodYear, periodMonth]
  );
  const report = created.rows[0];

  const products = await pool.query("select id from products order by sort_order");
  for (const p of products.rows) {
    await pool.query(
      "insert into report_fss (report_id, product_id, target_qty, actual_qty) values ($1,$2,0,0)",
      [report.id, p.id]
    );
  }
  for (const key of Object.keys(FFE_LABELS)) {
    await pool.query(
      "insert into report_ffe (report_id, metric_key, master_list_count, approved_count, achieved_count) values ($1,$2,0,0,0)",
      [report.id, key]
    );
  }
  await pool.query("insert into report_field_days (report_id) values ($1)", [report.id]);

  // Carry forward doctor tracking from the previous month: the last plan
  // becomes "locked previous target", MP reports actual result + sets a new plan.
  const prevMonth = periodMonth === 1 ? 12 : periodMonth - 1;
  const prevYear = periodMonth === 1 ? periodYear - 1 : periodYear;
  const prevReportRes = await pool.query(
    "select id from reports where mp_id=$1 and period_year=$2 and period_month=$3",
    [mpId, prevYear, prevMonth]
  );
  const prevReport = prevReportRes.rows[0];
  if (prevReport) {
    const prevConv = await pool.query("select * from report_conversion where report_id=$1", [prevReport.id]);
    for (const d of prevConv.rows) {
      await pool.query(
        `insert into report_conversion
         (report_id, product_id, doctor_name, doctor_specialty, lpu_name, current_rx_per_week, competitor_rx_per_week, competitor_reason, mp_action_plan, target_rx_per_week, previous_target_rx_per_week, start_date, control_date)
         values ($1,$2,$3,$4,$5,0,0,'','',0,$6,null,null)`,
        [report.id, d.product_id, d.doctor_name, d.doctor_specialty, d.lpu_name, d.target_rx_per_week]
      );
    }
    const prevPot = await pool.query("select * from report_potential where report_id=$1", [prevReport.id]);
    for (const d of prevPot.rows) {
      await pool.query(
        `insert into report_potential
         (report_id, product_id, doctor_name, doctor_specialty, lpu_name, current_potential_per_week, reason_not_treating, mp_action_plan, target_rx_per_week, previous_target_rx_per_week, start_date, control_date)
         values ($1,$2,$3,$4,$5,0,'','',0,$6,null,null)`,
        [report.id, d.product_id, d.doctor_name, d.doctor_specialty, d.lpu_name, d.target_rx_per_week]
      );
    }
  }

  return report;
}

app.post("/api/reports", auth, requireRole("mp"), async (req, res) => {
  const { period_year, period_month } = req.body;
  if (!period_year || !period_month) return res.status(400).json({ error: "Укажите год и месяц" });
  const report = await getOrCreateReport(req.user.id, period_year, period_month);
  res.json(report);
});

/* ---- report detail ---- */
app.get("/api/reports/:id", auth, async (req, res) => {
  const rid = req.params.id;
  const rRes = await pool.query("select * from reports where id = $1", [rid]);
  const report = rRes.rows[0];
  if (!report) return res.status(404).json({ error: "Отчёт не найден" });
  if (!(await canAccessReport(req.user, report))) return res.status(403).json({ error: "Forbidden" });

  const mpRes = await pool.query("select id, full_name, territory, rm_id from users where id=$1", [report.mp_id]);
  const fssRes = await pool.query(
    `select f.*, p.name as product_name, p.nrv_usd
     from report_fss f join products p on p.id = f.product_id
     where f.report_id = $1 order by p.sort_order`, [rid]
  );
  const ffeRes = await pool.query("select * from report_ffe where report_id=$1", [rid]);
  const fieldDaysRes = await pool.query("select * from report_field_days where report_id=$1", [rid]);
  const apRes = await pool.query("select * from report_action_plan where report_id=$1 order by sort_order, id", [rid]);
  const convRes = await pool.query(
    `select c.*, p.name as product_name, p.nrv_usd from report_conversion c join products p on p.id=c.product_id where c.report_id=$1 order by c.id`, [rid]
  );
  const potRes = await pool.query(
    `select c.*, p.name as product_name, p.nrv_usd from report_potential c join products p on p.id=c.product_id where c.report_id=$1 order by c.id`, [rid]
  );
  const commentsRes = await pool.query(
    `select c.*, u.full_name as author_name from report_comments c
     join users u on u.id = c.author_id where c.report_id=$1 order by c.created_at`, [rid]
  );
  const logRes = await pool.query(
    `select l.*, u.full_name as actor_name from report_status_log l
     join users u on u.id = l.actor_id where l.report_id=$1 order by l.created_at`, [rid]
  );

  // ---- Market opportunities (manual packages-impact estimates) ----
  const oppRes = await pool.query("select * from report_opportunities where report_id=$1 order by created_at", [rid]);
  const oppValuesRes = oppRes.rows.length
    ? await pool.query(
        `select ov.*, p.name as product_name from report_opportunity_values ov join products p on p.id=ov.product_id where ov.opportunity_id = any($1::bigint[])`,
        [oppRes.rows.map((o) => o.id)]
      )
    : { rows: [] };
  const opportunities = oppRes.rows.map((o) => ({
    ...o,
    values: oppValuesRes.rows.filter((v) => v.opportunity_id === o.id),
  }));

  // ---- computed FSS totals ----
  let targetUsd = 0, actualUsd = 0;
  const fssItems = fssRes.rows.map((row) => {
    const t = Number(row.target_qty) * Number(row.nrv_usd);
    const a = Number(row.actual_qty) * Number(row.nrv_usd);
    targetUsd += t; actualUsd += a;
    return { ...row, target_usd: t, actual_usd: a };
  });
  const achievement = targetUsd === 0 ? 0 : actualUsd / targetUsd;
  const rawBonusUzs = bonusFor(achievement, Number(report.base_rate_uzs));

  // ---- computed FFE score ----
  const ffeItems = ffeRes.rows.map((row) => {
    const denom = row.approved_count > 0 ? row.approved_count : row.master_list_count;
    const pct = denom > 0 ? row.achieved_count / denom : 0;
    return { ...row, label: FFE_LABELS[row.metric_key], percent: pct };
  });
  const ffeScore = ffeItems.length ? ffeItems.reduce((s, x) => s + x.percent, 0) / ffeItems.length : 0;
  const ffeGatePassed = ffeScore >= FFE_GATE;
  const nonReimbOk = report.non_reimbursement_ok;
  const finalBonusUzs = (ffeGatePassed && nonReimbOk) ? rawBonusUzs : 0;

  // ---- Conversion / Potential brand-level summary ----
  // base = this report's actual sales for the product (packs/month);
  // additional = sum of (target - current) Rx/week * WEEKS_PER_MONTH, converted to $ at NRV
  const WEEKS_PER_MONTH = 4.33;
  const baseByProduct = {};
  fssItems.forEach((it) => { baseByProduct[it.product_id] = { qty: Number(it.actual_qty), usd: it.actual_usd, nrv: Number(it.nrv_usd) }; });

  function buildBrandSummary(rows, currentField) {
    const byProduct = {};
    for (const r of rows) {
      const pid = r.product_id;
      if (!byProduct[pid]) byProduct[pid] = { product_id: pid, product_name: r.product_name, nrv_usd: Number(r.nrv_usd), additional_packs: 0 };
      const deltaPerWeek = Number(r.target_rx_per_week) - Number(r[currentField]);
      byProduct[pid].additional_packs += Math.max(0, deltaPerWeek) * WEEKS_PER_MONTH;
    }
    return Object.values(byProduct).map((b) => {
      const base = baseByProduct[b.product_id] || { qty: 0, usd: 0 };
      const additional_usd = b.additional_packs * b.nrv_usd;
      return {
        product_id: b.product_id, product_name: b.product_name,
        base_packs: base.qty, base_usd: base.usd,
        additional_packs: b.additional_packs, additional_usd,
        total_packs: base.qty + b.additional_packs, total_usd: base.usd + additional_usd,
      };
    });
  }

  const convSummary = buildBrandSummary(convRes.rows, "current_rx_per_week");
  const potSummary = buildBrandSummary(potRes.rows, "current_potential_per_week");

  // ---- Plan vs Actual for THIS month (the plan was set last month, MP now reports the result) ----
  function buildPlanVsActual(rows) {
    const byProduct = {};
    for (const r of rows) {
      if (r.previous_target_rx_per_week === null || r.previous_target_rx_per_week === undefined) continue;
      const pid = r.product_id;
      if (!byProduct[pid]) byProduct[pid] = { product_id: pid, product_name: r.product_name, nrv_usd: Number(r.nrv_usd), plan_rx: 0, fact_rx: 0, doctors: 0, doctors_achieved: 0 };
      const plan = Number(r.previous_target_rx_per_week);
      const fact = r.actual_result_rx_per_week === null || r.actual_result_rx_per_week === undefined ? 0 : Number(r.actual_result_rx_per_week);
      byProduct[pid].plan_rx += plan;
      byProduct[pid].fact_rx += fact;
      byProduct[pid].doctors += 1;
      if (fact >= plan) byProduct[pid].doctors_achieved += 1;
    }
    const items = Object.values(byProduct).map((b) => ({
      product_id: b.product_id, product_name: b.product_name,
      plan_packs: b.plan_rx * WEEKS_PER_MONTH, fact_packs: b.fact_rx * WEEKS_PER_MONTH,
      plan_usd: b.plan_rx * WEEKS_PER_MONTH * b.nrv_usd, fact_usd: b.fact_rx * WEEKS_PER_MONTH * b.nrv_usd,
      achievement: b.plan_rx ? b.fact_rx / b.plan_rx : null,
      doctors: b.doctors, doctors_achieved: b.doctors_achieved,
    }));
    const totals = items.reduce((s, it) => ({
      plan_packs: s.plan_packs + it.plan_packs, fact_packs: s.fact_packs + it.fact_packs,
      plan_usd: s.plan_usd + it.plan_usd, fact_usd: s.fact_usd + it.fact_usd,
    }), { plan_packs: 0, fact_packs: 0, plan_usd: 0, fact_usd: 0 });
    totals.achievement = totals.plan_usd ? totals.fact_usd / totals.plan_usd : null;
    return { items, totals };
  }
  const conversionPlanVsActual = buildPlanVsActual(convRes.rows);
  const potentialPlanVsActual = buildPlanVsActual(potRes.rows);

  // ---- Next-month sales forecast: base + conversion + potential + opportunities ----
  const nextMonth = report.period_month === 12 ? 1 : report.period_month + 1;
  const nextYear = report.period_month === 12 ? report.period_year + 1 : report.period_year;
  const nextReportRes = await pool.query(
    "select id from reports where mp_id=$1 and period_year=$2 and period_month=$3", [report.mp_id, nextYear, nextMonth]
  );
  let nextTargetByProduct = {};
  if (nextReportRes.rows[0]) {
    const nextFssRes = await pool.query(
      `select f.product_id, f.target_qty, p.nrv_usd from report_fss f join products p on p.id=f.product_id where f.report_id=$1`,
      [nextReportRes.rows[0].id]
    );
    for (const r of nextFssRes.rows) nextTargetByProduct[r.product_id] = { qty: Number(r.target_qty), usd: Number(r.target_qty) * Number(r.nrv_usd) };
  }

  const convByProduct = Object.fromEntries(convSummary.map((s) => [s.product_id, s.additional_packs]));
  const potByProduct = Object.fromEntries(potSummary.map((s) => [s.product_id, s.additional_packs]));
  const oppByProduct = {};
  for (const o of opportunities) {
    for (const v of o.values) {
      oppByProduct[v.product_id] = (oppByProduct[v.product_id] || 0) + Number(v.qty_packages);
    }
  }
  const forecast = fssItems.map((it) => {
    const base_packs = Number(it.actual_qty);
    const conv_packs = convByProduct[it.product_id] || 0;
    const pot_packs = potByProduct[it.product_id] || 0;
    const opp_packs = oppByProduct[it.product_id] || 0;
    const total_packs = base_packs + conv_packs + pot_packs + opp_packs;
    const nrv = Number(it.nrv_usd);
    const nextTarget = nextTargetByProduct[it.product_id];
    return {
      product_id: it.product_id, product_name: it.product_name, nrv_usd: nrv,
      base_packs, conv_packs, pot_packs, opp_packs, total_packs,
      base_usd: base_packs * nrv, conv_usd: conv_packs * nrv, pot_usd: pot_packs * nrv, opp_usd: opp_packs * nrv, total_usd: total_packs * nrv,
      next_target_qty: nextTarget ? nextTarget.qty : null, next_target_usd: nextTarget ? nextTarget.usd : null,
      achievement_pct: nextTarget && nextTarget.usd ? (total_packs * nrv) / nextTarget.usd : null,
    };
  });
  const forecastTotals = forecast.reduce((s, f) => ({
    base_usd: s.base_usd + f.base_usd, conv_usd: s.conv_usd + f.conv_usd, pot_usd: s.pot_usd + f.pot_usd, opp_usd: s.opp_usd + f.opp_usd,
    total_usd: s.total_usd + f.total_usd, next_target_usd: s.next_target_usd + (f.next_target_usd || 0),
  }), { base_usd: 0, conv_usd: 0, pot_usd: 0, opp_usd: 0, total_usd: 0, next_target_usd: 0 });
  forecastTotals.achievement_pct = forecastTotals.next_target_usd ? forecastTotals.total_usd / forecastTotals.next_target_usd : null;

  res.json({
    report,
    mp: mpRes.rows[0],
    fss: {
      items: fssItems, target_usd: targetUsd, actual_usd: actualUsd, achievement,
      raw_bonus_uzs: rawBonusUzs, bonus_uzs: finalBonusUzs, bonus_usd: finalBonusUzs / Number(report.fx_rate),
      tier_label: tierLabel(achievement),
      gates: {
        ffe_gate_passed: ffeGatePassed, ffe_score: ffeScore, ffe_threshold: FFE_GATE,
        non_reimbursement_ok: nonReimbOk,
      },
    },
    ffe: { items: ffeItems, score: ffeScore, gate_passed: ffeGatePassed, gate_threshold: FFE_GATE },
    field_days: fieldDaysRes.rows[0],
    action_plan: apRes.rows,
    conversion: { items: convRes.rows, summary: convSummary, planVsActual: conversionPlanVsActual },
    potential: { items: potRes.rows, summary: potSummary, planVsActual: potentialPlanVsActual },
    opportunities,
    forecast: { items: forecast, totals: forecastTotals, period_year: nextYear, period_month: nextMonth },
    comments: commentsRes.rows,
    status_log: logRes.rows,
  });
});

/* ---- Market opportunities: MP adds an opportunity, then fills in per-product packages impact ---- */
app.post("/api/reports/:id/opportunities", auth, requireRole("mp"), async (req, res) => {
  const rid = req.params.id;
  const rRes = await pool.query("select * from reports where id=$1 and mp_id=$2", [rid, req.user.id]);
  const report = rRes.rows[0];
  if (!report) return res.status(404).json({ error: "Не найдено" });
  if (!assertEditable(report, res)) return;
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Укажите название возможности" });
  const { rows } = await pool.query(
    "insert into report_opportunities (report_id, name, created_by) values ($1,$2,$3) returning *",
    [rid, name.trim(), req.user.id]
  );
  res.json({ ...rows[0], values: [] });
});

app.put("/api/reports/:id/opportunities/:oppId", auth, requireRole("mp"), async (req, res) => {
  const { id: rid, oppId } = req.params;
  const rRes = await pool.query("select * from reports where id=$1 and mp_id=$2", [rid, req.user.id]);
  const report = rRes.rows[0];
  if (!report) return res.status(404).json({ error: "Не найдено" });
  if (!assertEditable(report, res)) return;
  const check = await pool.query("select id from report_opportunities where id=$1 and report_id=$2", [oppId, rid]);
  if (!check.rows[0]) return res.status(404).json({ error: "Возможность не найдена" });
  const { values } = req.body; // [{product_id, qty_packages}]
  for (const v of values || []) {
    await pool.query(
      `insert into report_opportunity_values (opportunity_id, product_id, qty_packages) values ($1,$2,$3)
       on conflict (opportunity_id, product_id) do update set qty_packages=excluded.qty_packages`,
      [oppId, v.product_id, v.qty_packages || 0]
    );
  }
  res.json({ ok: true });
});

app.delete("/api/reports/:id/opportunities/:oppId", auth, requireRole("mp"), async (req, res) => {
  const { id: rid, oppId } = req.params;
  const rRes = await pool.query("select * from reports where id=$1 and mp_id=$2", [rid, req.user.id]);
  const report = rRes.rows[0];
  if (!report) return res.status(404).json({ error: "Не найдено" });
  if (!assertEditable(report, res)) return;
  await pool.query("delete from report_opportunities where id=$1 and report_id=$2", [oppId, rid]);
  res.json({ ok: true });
});

/* ---- MP updates: FSS / FFE / action plan / settings (only draft/returned) ---- */
function assertEditable(report, res) {
  if (!["draft", "returned"].includes(report.status)) {
    res.status(409).json({ error: "Отчёт уже отправлен на рассмотрение — редактирование недоступно" });
    return false;
  }
  return true;
}

app.put("/api/reports/:id/fss", auth, requireRole("mp"), async (req, res) => {
  const rid = req.params.id;
  const rRes = await pool.query("select * from reports where id=$1 and mp_id=$2", [rid, req.user.id]);
  const report = rRes.rows[0];
  if (!report) return res.status(404).json({ error: "Не найдено" });
  if (!assertEditable(report, res)) return;
  const { items } = req.body; // [{product_id, target_qty, actual_qty}]
  for (const it of items) {
    await pool.query(
      "update report_fss set target_qty=$1, actual_qty=$2 where report_id=$3 and product_id=$4",
      [it.target_qty || 0, it.actual_qty || 0, rid, it.product_id]
    );
  }
  await pool.query("update reports set updated_at = now() where id=$1", [rid]);
  res.json({ ok: true });
});

app.put("/api/reports/:id/ffe", auth, requireRole("mp"), async (req, res) => {
  const rid = req.params.id;
  const rRes = await pool.query("select * from reports where id=$1 and mp_id=$2", [rid, req.user.id]);
  const report = rRes.rows[0];
  if (!report) return res.status(404).json({ error: "Не найдено" });
  if (!assertEditable(report, res)) return;
  const { items, field_days } = req.body;
  for (const it of items || []) {
    await pool.query(
      "update report_ffe set master_list_count=$1, approved_count=$2, achieved_count=$3 where report_id=$4 and metric_key=$5",
      [it.master_list_count || 0, it.approved_count || 0, it.achieved_count || 0, rid, it.metric_key]
    );
  }
  if (field_days) {
    await pool.query(
      `update report_field_days set total_days=$1, non_working_days=$2, public_holidays=$3, training_days=$4, leave_days=$5, field_days=$6
       where report_id=$7`,
      [field_days.total_days, field_days.non_working_days, field_days.public_holidays, field_days.training_days, field_days.leave_days, field_days.field_days, rid]
    );
  }
  await pool.query("update reports set updated_at = now() where id=$1", [rid]);
  res.json({ ok: true });
});

app.put("/api/reports/:id/action-plan", auth, requireRole("mp"), async (req, res) => {
  const rid = req.params.id;
  const rRes = await pool.query("select * from reports where id=$1 and mp_id=$2", [rid, req.user.id]);
  const report = rRes.rows[0];
  if (!report) return res.status(404).json({ error: "Не найдено" });
  if (!assertEditable(report, res)) return;
  const { items } = req.body; // [{id?, product_name, goal, action_text, control_date, completion_date}]
  await pool.query("delete from report_action_plan where report_id=$1", [rid]);
  let order = 0;
  for (const it of items || []) {
    await pool.query(
      `insert into report_action_plan (report_id, product_name, goal, action_text, control_date, completion_date, sort_order)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [rid, it.product_name || "", it.goal || "", it.action_text || "", it.control_date || null, it.completion_date || null, order++]
    );
  }
  await pool.query("update reports set updated_at = now() where id=$1", [rid]);
  res.json({ ok: true });

  // fire-and-forget: email calendar invites for control/completion dates (no-op if SMTP not configured)
  try {
    const mpRes = await pool.query("select id, full_name, email, rm_id from users where id=$1", [req.user.id]);
    const mpRow = mpRes.rows[0];
    let rmEmail = null;
    if (mpRow?.rm_id) {
      const rmRes = await pool.query("select email from users where id=$1", [mpRow.rm_id]);
      rmEmail = rmRes.rows[0]?.email || null;
    }
    await sendActionPlanReminders(mpRow, rmEmail, items || []);
  } catch (e) {
    console.error("Action plan reminder dispatch failed:", e.message);
  }
});

app.put("/api/reports/:id/conversion", auth, requireRole("mp"), async (req, res) => {
  const rid = req.params.id;
  const rRes = await pool.query("select * from reports where id=$1 and mp_id=$2", [rid, req.user.id]);
  const report = rRes.rows[0];
  if (!report) return res.status(404).json({ error: "Не найдено" });
  if (!assertEditable(report, res)) return;
  const { items } = req.body;
  await pool.query("delete from report_conversion where report_id=$1", [rid]);
  for (const it of items || []) {
    await pool.query(
      `insert into report_conversion
       (report_id, product_id, doctor_name, doctor_specialty, lpu_name, current_rx_per_week, competitor_rx_per_week, competitor_reason, mp_action_plan, target_rx_per_week, previous_target_rx_per_week, actual_result_rx_per_week, start_date, control_date)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [rid, it.product_id, it.doctor_name || "", it.doctor_specialty || "", it.lpu_name || "", it.current_rx_per_week || 0, it.competitor_rx_per_week || 0,
       it.competitor_reason || "", it.mp_action_plan || "", it.target_rx_per_week || 0, it.previous_target_rx_per_week ?? null, it.actual_result_rx_per_week ?? null, it.start_date || null, it.control_date || null]
    );
  }
  await pool.query("update reports set updated_at = now() where id=$1", [rid]);
  res.json({ ok: true });
});

app.put("/api/reports/:id/potential", auth, requireRole("mp"), async (req, res) => {
  const rid = req.params.id;
  const rRes = await pool.query("select * from reports where id=$1 and mp_id=$2", [rid, req.user.id]);
  const report = rRes.rows[0];
  if (!report) return res.status(404).json({ error: "Не найдено" });
  if (!assertEditable(report, res)) return;
  const { items } = req.body;
  await pool.query("delete from report_potential where report_id=$1", [rid]);
  for (const it of items || []) {
    await pool.query(
      `insert into report_potential
       (report_id, product_id, doctor_name, doctor_specialty, lpu_name, current_potential_per_week, reason_not_treating, mp_action_plan, target_rx_per_week, previous_target_rx_per_week, actual_result_rx_per_week, start_date, control_date)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [rid, it.product_id, it.doctor_name || "", it.doctor_specialty || "", it.lpu_name || "", it.current_potential_per_week || 0,
       it.reason_not_treating || "", it.mp_action_plan || "", it.target_rx_per_week || 0, it.previous_target_rx_per_week ?? null, it.actual_result_rx_per_week ?? null, it.start_date || null, it.control_date || null]
    );
  }
  await pool.query("update reports set updated_at = now() where id=$1", [rid]);
  res.json({ ok: true });
});

async function checkWeeklyReminders() {
  if (!mailEnabled) return;
  for (const entityType of ["conversion", "potential"]) {
    const table = entityType === "conversion" ? "report_conversion" : "report_potential";
    const rows = await pool.query(`select * from ${table} where control_date is not null`);
    for (const row of rows.rows) {
      const lastRes = await pool.query(
        "select sent_at from reminder_log where entity_type=$1 and entity_id=$2 order by sent_at desc limit 1",
        [entityType, row.id]
      );
      const last = lastRes.rows[0];
      const daysSince = last ? (Date.now() - new Date(last.sent_at).getTime()) / 86400000 : Infinity;
      if (daysSince < 7) continue;

      const repRes = await pool.query(
        "select r.id, u.full_name as mp_name, u.email as mp_email, u.rm_id from reports r join users u on u.id=r.mp_id where r.id=$1",
        [row.report_id]
      );
      const rep = repRes.rows[0];
      if (!rep) continue;
      let rmEmail = null;
      if (rep.rm_id) {
        const rmRes = await pool.query("select email from users where id=$1", [rep.rm_id]);
        rmEmail = rmRes.rows[0]?.email || null;
      }
      const prodRes = await pool.query("select name from products where id=$1", [row.product_id]);
      const productName = prodRes.rows[0]?.name || "";
      const kindLabel = entityType === "conversion" ? "Конверсия" : "Увеличение потенциала";

      try {
        await transporter.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to: rep.mp_email,
          cc: rmEmail || undefined,
          subject: `[${kindLabel}] Еженедельное напоминание — врач ${row.doctor_name}`,
          text: `Препарат: ${productName}\nВрач: ${row.doctor_name}\nДата контроля: ${row.control_date}\n\nЭто еженедельное напоминание обсудить с региональным менеджером прогресс по данному врачу (раздел "${kindLabel}").`,
        });
        await pool.query("insert into reminder_log (entity_type, entity_id) values ($1,$2)", [entityType, row.id]);
      } catch (e) {
        console.error(`Weekly reminder send failed for ${entityType}#${row.id}:`, e.message);
      }
    }
  }
}
if (mailEnabled) {
  cron.schedule("0 8 * * *", () => { checkWeeklyReminders().catch((e) => console.error("Weekly reminder job failed:", e.message)); });
}

app.put("/api/reports/:id/settings", auth, async (req, res) => {
  const rid = req.params.id;
  const rRes = await pool.query("select * from reports where id=$1", [rid]);
  const report = rRes.rows[0];
  if (!report) return res.status(404).json({ error: "Не найдено" });
  if (!(await canAccessReport(req.user, report))) return res.status(403).json({ error: "Forbidden" });
  if (req.user.role === "mp" && !assertEditable(report, res)) return;
  const { base_rate_uzs, fx_rate, non_reimbursement_ok, underperformance_note } = req.body;
  if (non_reimbursement_ok !== undefined && req.user.role === "mp") {
    return res.status(403).json({ error: "Только РМ или мастер может подтверждать условие non-reimbursement" });
  }
  await pool.query(
    `update reports set base_rate_uzs=coalesce($1,base_rate_uzs), fx_rate=coalesce($2,fx_rate),
     non_reimbursement_ok=coalesce($3,non_reimbursement_ok), underperformance_note=coalesce($4,underperformance_note) where id=$5`,
    [base_rate_uzs, fx_rate, non_reimbursement_ok, underperformance_note, rid]
  );
  res.json({ ok: true });
});

/* ---- workflow transitions ---- */
async function logTransition(rid, from, to, actorId, note) {
  await pool.query(
    "insert into report_status_log (report_id, from_status, to_status, actor_id, note) values ($1,$2,$3,$4,$5)",
    [rid, from, to, actorId, note || null]
  );
}

app.post("/api/reports/:id/submit", auth, requireRole("mp"), async (req, res) => {
  const rid = req.params.id;
  const rRes = await pool.query("select * from reports where id=$1 and mp_id=$2", [rid, req.user.id]);
  const report = rRes.rows[0];
  if (!report) return res.status(404).json({ error: "Не найдено" });
  if (!["draft", "returned"].includes(report.status)) return res.status(409).json({ error: "Отчёт уже отправлен" });
  await pool.query("update reports set status='submitted', submitted_at=now() where id=$1", [rid]);
  await logTransition(rid, report.status, "submitted", req.user.id);
  res.json({ ok: true });
});

app.post("/api/reports/:id/return", auth, requireRole("rm"), async (req, res) => {
  const rid = req.params.id;
  const rRes = await pool.query("select * from reports where id=$1", [rid]);
  const report = rRes.rows[0];
  if (!report) return res.status(404).json({ error: "Не найдено" });
  if (!(await canAccessReport(req.user, report))) return res.status(403).json({ error: "Forbidden" });
  if (report.status !== "submitted") return res.status(409).json({ error: "Отчёт не находится на рассмотрении" });
  await pool.query("update reports set status='returned' where id=$1", [rid]);
  if (req.body.comment_text) {
    await pool.query(
      "insert into report_comments (report_id, section, author_id, author_role, comment_text) values ($1,'general',$2,$3,$4)",
      [rid, req.user.id, req.user.role, req.body.comment_text]
    );
  }
  await logTransition(rid, "submitted", "returned", req.user.id, req.body.comment_text);
  res.json({ ok: true });
});

app.post("/api/reports/:id/approve-rm", auth, requireRole("rm"), async (req, res) => {
  const rid = req.params.id;
  const rRes = await pool.query("select * from reports where id=$1", [rid]);
  const report = rRes.rows[0];
  if (!report) return res.status(404).json({ error: "Не найдено" });
  if (!(await canAccessReport(req.user, report))) return res.status(403).json({ error: "Forbidden" });
  if (report.status !== "submitted") return res.status(409).json({ error: "Отчёт не находится на рассмотрении" });
  await pool.query("update reports set status='approved', rm_reviewed_at=now() where id=$1", [rid]);
  await logTransition(rid, "submitted", "approved", req.user.id, req.body.comment_text);
  if (req.body.comment_text) {
    await pool.query(
      "insert into report_comments (report_id, section, author_id, author_role, comment_text) values ($1,'general',$2,$3,$4)",
      [rid, req.user.id, req.user.role, req.body.comment_text]
    );
  }
  res.json({ ok: true });
});

app.post("/api/reports/:id/comment", auth, requireRole("rm", "master", "mp", "bm"), async (req, res) => {
  const rid = req.params.id;
  const rRes = await pool.query("select * from reports where id=$1", [rid]);
  const report = rRes.rows[0];
  if (!report) return res.status(404).json({ error: "Не найдено" });
  if (!(await canAccessReport(req.user, report))) return res.status(403).json({ error: "Forbidden" });
  const { section, item_ref, comment_text } = req.body;
  if (!comment_text) return res.status(400).json({ error: "Пустой комментарий" });
  const { rows } = await pool.query(
    `insert into report_comments (report_id, section, item_ref, author_id, author_role, comment_text)
     values ($1,$2,$3,$4,$5,$6) returning *`,
    [rid, section || "general", item_ref || null, req.user.id, req.user.role, comment_text]
  );
  res.json(rows[0]);
});

/* ============================================================
   Shared: quarterly bonus computation for one MP (3 monthly reports)
   The Incentive Policy computes bonus per QUARTER, while MPs fill in
   reports per MONTH — this aggregates the 3 months into the real,
   policy-accurate quarterly number.
   ============================================================ */
async function computeMpQuarterBonus(mpId, year, quarter) {
  const months = monthsInQuarter(Number(quarter));
  const repsRes = await pool.query(
    `select r.* from reports r where r.mp_id=$1 and r.period_year=$2 and r.period_month = any($3::int[]) order by r.period_month`,
    [mpId, year, months]
  );
  const reps = repsRes.rows;
  let target = 0, actual = 0, ffeSum = 0, nonReimbOk = true;
  const monthly = [];
  for (const m of months) {
    const r = reps.find((x) => x.period_month === m);
    if (!r) { monthly.push({ month: m, found: false }); continue; }
    const fssRes = await pool.query(
      `select f.target_qty, f.actual_qty, p.nrv_usd from report_fss f join products p on p.id=f.product_id where f.report_id=$1`, [r.id]
    );
    let mTarget = 0, mActual = 0;
    for (const row of fssRes.rows) {
      mTarget += Number(row.target_qty) * Number(row.nrv_usd);
      mActual += Number(row.actual_qty) * Number(row.nrv_usd);
    }
    target += mTarget; actual += mActual;
    const ffeRes = await pool.query("select * from report_ffe where report_id=$1", [r.id]);
    const items = ffeRes.rows.map((row) => {
      const denom = row.approved_count > 0 ? row.approved_count : row.master_list_count;
      return denom > 0 ? row.achieved_count / denom : 0;
    });
    const ffeAvg = items.length ? items.reduce((s, x) => s + x, 0) / items.length : 0;
    ffeSum += ffeAvg;
    if (!r.non_reimbursement_ok) nonReimbOk = false;
    monthly.push({ month: m, found: true, status: r.status, target_usd: mTarget, actual_usd: mActual, ffe_score: ffeAvg });
  }
  const allApproved = reps.length === 3 && reps.every((r) => r.status === "approved");
  const ffeAvg = reps.length ? ffeSum / reps.length : 0;
  const achievement = target === 0 ? 0 : actual / target;
  const baseRateQuarter = reps[0] ? Number(reps[0].base_rate_uzs) : 15000000;
  const rawBonus = bonusFor(achievement, baseRateQuarter);
  const ffeGatePassed = ffeAvg >= FFE_GATE;
  const qualifies = allApproved && achievement >= 0.9 && ffeGatePassed && nonReimbOk;
  const bonus = qualifies ? rawBonus : 0;
  return {
    year: Number(year), quarter: Number(quarter), months, monthly,
    target_usd: target, actual_usd: actual, achievement, tier_label: tierLabel(achievement),
    ffe_score: ffeAvg, ffe_gate_passed: ffeGatePassed, non_reimbursement_ok: nonReimbOk,
    all_months_approved: allApproved, raw_bonus_uzs: rawBonus, bonus_uzs: bonus,
    base_rate_uzs: baseRateQuarter,
  };
}

app.get("/api/mp-bonus/:mpId", auth, async (req, res) => {
  const { mpId } = req.params;
  const { year, quarter } = req.query;
  if (!year || !quarter) return res.status(400).json({ error: "Укажите year и quarter" });
  if (req.user.role === "mp" && String(req.user.id) !== String(mpId)) return res.status(403).json({ error: "Forbidden" });
  if (req.user.role === "rm") {
    const chk = await pool.query("select rm_id from users where id=$1", [mpId]);
    if (!chk.rows[0] || chk.rows[0].rm_id !== req.user.id) return res.status(403).json({ error: "Forbidden" });
  }
  const mpRes = await pool.query("select id, full_name, territory from users where id=$1 and role='mp'", [mpId]);
  if (!mpRes.rows[0]) return res.status(404).json({ error: "МП не найден" });
  const data = await computeMpQuarterBonus(mpId, year, quarter);
  res.json({ mp: mpRes.rows[0], ...data });
});

/* ============================================================
   ALL COMMENTS — master sees every conversation on the platform
   ============================================================ */
app.get("/api/comments/all", auth, requireRole("master"), async (req, res) => {
  const { rows } = await pool.query(`
    select c.*, u.full_name as author_name,
           r.period_year, r.period_month, r.status as report_status,
           mp.full_name as mp_name, mp.id as mp_id, rm.full_name as rm_name
    from report_comments c
    join users u on u.id = c.author_id
    join reports r on r.id = c.report_id
    join users mp on mp.id = r.mp_id
    left join users rm on rm.id = mp.rm_id
    order by c.created_at desc
    limit 500
  `);
  res.json(rows);
});

/* ============================================================
   RM BONUS — multiplier x average bonus of the MR team
   (Incentive Policy FY'27, "RM bonusi multiplikatori")
   ============================================================ */
app.get("/api/rm-bonus", auth, async (req, res) => {
  const { year, quarter, rm_id } = req.query;
  if (!year || !quarter) return res.status(400).json({ error: "Укажите year и quarter" });

  let targetRmId;
  if (req.user.role === "rm") {
    targetRmId = req.user.id;
  } else if (req.user.role === "master") {
    if (!rm_id) return res.status(400).json({ error: "Укажите rm_id" });
    targetRmId = rm_id;
  } else {
    return res.status(403).json({ error: "Forbidden" });
  }

  const rmRes = await pool.query("select id, full_name, territory from users where id=$1 and role='rm'", [targetRmId]);
  const rm = rmRes.rows[0];
  if (!rm) return res.status(404).json({ error: "РМ не найден" });

  const mpsRes = await pool.query("select id, full_name, territory from users where rm_id=$1 and role='mp' and is_active=true order by full_name", [targetRmId]);
  const mps = mpsRes.rows;

  const team = [];
  let teamTargetUsd = 0, teamActualUsd = 0;
  for (const mp of mps) {
    const d = await computeMpQuarterBonus(mp.id, year, quarter);
    teamTargetUsd += d.target_usd; teamActualUsd += d.actual_usd;
    team.push({
      mp_id: mp.id, mp_name: mp.full_name, territory: mp.territory,
      reports_found: d.monthly.filter((m) => m.found).length, all_approved: d.all_months_approved,
      achievement: d.achievement, ffe_score: d.ffe_score, non_reimbursement_ok: d.non_reimbursement_ok,
      qualifies: d.bonus_uzs > 0, bonus_uzs: d.bonus_uzs,
    });
  }

  const qualifiedCount = team.filter((t) => t.qualifies).length;
  const teamQualifies = mps.length > 0 && qualifiedCount / mps.length >= 0.5;
  const avgMrBonus = team.length ? team.reduce((s, t) => s + t.bonus_uzs, 0) / team.length : 0;
  const rmAchievement = teamTargetUsd === 0 ? 0 : teamActualUsd / teamTargetUsd; // RM territory = sum of MP territories
  const multiplier = rmMultiplier(rmAchievement);
  const rmBonusUzs = (teamQualifies && rmAchievement >= 0.9) ? multiplier * avgMrBonus : 0;

  res.json({
    rm, year: Number(year), quarter: Number(quarter),
    team, team_size: mps.length, qualified_count: qualifiedCount, team_qualifies: teamQualifies,
    rm_achievement: rmAchievement, rm_target_usd: teamTargetUsd, rm_actual_usd: teamActualUsd,
    multiplier, multiplier_label: rmMultiplierLabel(rmAchievement),
    avg_mr_bonus_uzs: avgMrBonus, rm_bonus_uzs: rmBonusUzs,
  });
});

/* ============================================================
   DOC TRACKING — doctors sent to conferences; weekly monitoring of
   Rx/sales at 10 indicator pharmacies; USD contribution computed
   automatically from the existing product price list (no manual
   price entry, no separate price sheet — fully reuses `products`).
   Visibility: MP → own doctors; RM → own team's; BM → own group's;
   Master → all.
   ============================================================ */
async function docTrackingScope(user) {
  // returns { where: sql fragment referencing "td", values: [] }
  if (user.role === "master") return { where: "1=1", values: [] };
  if (user.role === "mp") return { where: "td.territory = (select territory from users where id = $1)", values: [user.id] };
  if (user.role === "rm") return { where: "td.territory in (select territory from users where rm_id = $1 and role='mp' and territory is not null)", values: [user.id] };
  if (user.role === "bm") return { where: "td.territory in (select territory from users where group_id = $1 and role='mp' and territory is not null)", values: [user.group_id] };
  return { where: "1=0", values: [] };
}

async function canAccessDoctor(user, doctorId) {
  const r = await pool.query(`select territory from tracked_doctors where id=$1`, [doctorId]);
  const row = r.rows[0];
  if (!row) return false;
  if (user.role === "master") return true;
  if (!row.territory) return false;
  if (user.role === "mp") return row.territory === user.territory;
  if (user.role === "rm") {
    const t = await pool.query("select 1 from users where rm_id=$1 and role='mp' and territory=$2", [user.id, row.territory]);
    return t.rows.length > 0;
  }
  if (user.role === "bm") {
    const t = await pool.query("select 1 from users where group_id=$1 and role='mp' and territory=$2", [user.group_id, row.territory]);
    return t.rows.length > 0;
  }
  return false;
}

app.get("/api/doc-tracking/doctors", auth, async (req, res) => {
  const scope = await docTrackingScope(req.user);
  const { rows } = await pool.query(
    `select td.*, mp.full_name as mp_name
     from tracked_doctors td left join users mp on mp.id=td.mp_id
     where ${scope.where} order by td.created_at desc`,
    scope.values
  );
  res.json(rows);
});

app.post("/api/doc-tracking/doctors", auth, requireRole("mp"), async (req, res) => {
  const { full_name, specialty, city, clinic, contact, trip_start, trip_end, event_name, event_city, pharmacies } = req.body;
  if (!full_name || !full_name.trim()) return res.status(400).json({ error: "Укажите ФИО врача" });
  const { rows } = await pool.query(
    `insert into tracked_doctors (mp_id, territory, full_name, specialty, city, clinic, contact, trip_start, trip_end, event_name, event_city)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
    [req.user.id, req.user.territory || null, full_name, specialty || null, city || null, clinic || null, contact || null, trip_start || null, trip_end || null, event_name || null, event_city || null]
  );
  const doctor = rows[0];
  let order = 0;
  for (const p of (pharmacies || []).slice(0, 10)) {
    if (!p.name) continue;
    await pool.query("insert into doctor_pharmacies (doctor_id, name, address, sort_order) values ($1,$2,$3,$4)", [doctor.id, p.name, p.address || "", order++]);
  }
  res.json(doctor);
});

app.put("/api/doc-tracking/doctors/:id", auth, requireRole("mp"), async (req, res) => {
  const { id } = req.params;
  if (!(await canAccessDoctor(req.user, id))) return res.status(403).json({ error: "Forbidden" });
  const { full_name, specialty, city, clinic, contact, trip_start, trip_end, event_name, event_city, pharmacies } = req.body;
  await pool.query(
    `update tracked_doctors set full_name=$1, specialty=$2, city=$3, clinic=$4, contact=$5, trip_start=$6, trip_end=$7, event_name=$8, event_city=$9 where id=$10`,
    [full_name, specialty || null, city || null, clinic || null, contact || null, trip_start || null, trip_end || null, event_name || null, event_city || null, id]
  );
  if (pharmacies) {
    await pool.query("delete from doctor_pharmacies where doctor_id=$1", [id]);
    let order = 0;
    for (const p of pharmacies.slice(0, 10)) {
      if (!p.name) continue;
      await pool.query("insert into doctor_pharmacies (doctor_id, name, address, sort_order) values ($1,$2,$3,$4)", [id, p.name, p.address || "", order++]);
    }
  }
  res.json({ ok: true });
});

app.get("/api/doc-tracking/doctors/:id", auth, async (req, res) => {
  const { id } = req.params;
  if (!(await canAccessDoctor(req.user, id))) return res.status(403).json({ error: "Forbidden" });
  const docRes = await pool.query(
    `select td.*, mp.full_name as mp_name from tracked_doctors td left join users mp on mp.id=td.mp_id where td.id=$1`, [id]
  );
  const pharmRes = await pool.query("select * from doctor_pharmacies where doctor_id=$1 order by sort_order", [id]);
  const logRes = await pool.query(
    `select l.*, p.name as product_name, p.nrv_usd, ph.name as pharmacy_name
     from doctor_weekly_log l join products p on p.id=l.product_id left join doctor_pharmacies ph on ph.id=l.pharmacy_id
     where l.doctor_id=$1 order by l.log_date desc`, [id]
  );
  const logWithUsd = logRes.rows.map((r) => ({ ...r, usd: Number(r.qty_packages) * Number(r.nrv_usd) }));

  const monthly = {};
  const pharmacyMonthly = {}; // { pharmacyName: { "2026-6": { qty, usd } } }
  for (const r of logWithUsd) {
    const d = new Date(r.log_date);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    monthly[key] ||= { year: d.getFullYear(), month: d.getMonth() + 1, qty: 0, usd: 0 };
    monthly[key].qty += Number(r.qty_packages);
    monthly[key].usd += r.usd;

    const pharmName = r.pharmacy_name || "Без аптеки";
    pharmacyMonthly[pharmName] ||= {};
    pharmacyMonthly[pharmName][key] ||= { year: d.getFullYear(), month: d.getMonth() + 1, qty: 0, usd: 0 };
    pharmacyMonthly[pharmName][key].qty += Number(r.qty_packages);
    pharmacyMonthly[pharmName][key].usd += r.usd;
  }
  const monthlySummary = Object.values(monthly).sort((a, b) => (a.year - b.year) || (a.month - b.month));
  const pharmacyMonthlySummary = Object.entries(pharmacyMonthly).map(([pharmacy_name, byMonth]) => ({
    pharmacy_name,
    months: Object.values(byMonth).sort((a, b) => (a.year - b.year) || (a.month - b.month)),
    total_usd: Object.values(byMonth).reduce((s, m) => s + m.usd, 0),
  }));

  res.json({ doctor: docRes.rows[0], pharmacies: pharmRes.rows, log: logWithUsd, monthly: monthlySummary, pharmacyMonthly: pharmacyMonthlySummary, total_usd: logWithUsd.reduce((s, r) => s + r.usd, 0) });
});

app.post("/api/doc-tracking/doctors/:id/log", auth, requireRole("mp"), async (req, res) => {
  const { id } = req.params;
  if (!(await canAccessDoctor(req.user, id))) return res.status(403).json({ error: "Forbidden" });
  const { log_date, pharmacy_id, product_id, qty_packages } = req.body;
  if (!log_date || !product_id) return res.status(400).json({ error: "Укажите дату и препарат" });
  const { rows } = await pool.query(
    "insert into doctor_weekly_log (doctor_id, log_date, pharmacy_id, product_id, qty_packages) values ($1,$2,$3,$4,$5) returning *",
    [id, log_date, pharmacy_id || null, product_id, qty_packages || 0]
  );
  res.json(rows[0]);
});

app.delete("/api/doc-tracking/log/:logId", auth, requireRole("mp"), async (req, res) => {
  const { logId } = req.params;
  const check = await pool.query(
    `select l.id from doctor_weekly_log l join tracked_doctors td on td.id=l.doctor_id where l.id=$1 and td.mp_id=$2`,
    [logId, req.user.id]
  );
  if (!check.rows[0]) return res.status(403).json({ error: "Forbidden" });
  await pool.query("delete from doctor_weekly_log where id=$1", [logId]);
  res.json({ ok: true });
});

/* ============================================================
   MP PROFILE — RM's "Моя команда" detail view: history, comments,
   sales trend, bonus, and the development-plan editor.
   ============================================================ */
async function assertMpAccess(user, mpId) {
  if (user.role === "master") return true;
  if (user.role === "rm") {
    const r = await pool.query("select rm_id from users where id=$1", [mpId]);
    return r.rows[0] && r.rows[0].rm_id === user.id;
  }
  if (user.role === "bm") {
    const r = await pool.query("select group_id from users where id=$1", [mpId]);
    return r.rows[0] && r.rows[0].group_id === user.group_id;
  }
  return false;
}

app.get("/api/mp-profile/:mpId", auth, requireRole("rm", "master", "bm"), async (req, res) => {
  const { mpId } = req.params;
  if (!(await assertMpAccess(req.user, mpId))) return res.status(403).json({ error: "Forbidden" });

  const mpRes = await pool.query(
    `select u.id, u.full_name, u.email, u.territory, u.group_id, g.name as group_name, u.rm_id
     from users u left join groups g on g.id=u.group_id where u.id=$1 and u.role='mp'`, [mpId]
  );
  if (!mpRes.rows[0]) return res.status(404).json({ error: "МП не найден" });

  const reportsRes = await pool.query(
    "select id, period_year, period_month, status, submitted_at from reports where mp_id=$1 order by period_year desc, period_month desc limit 24",
    [mpId]
  );
  const reportIds = reportsRes.rows.map((r) => r.id);
  let history = [];
  if (reportIds.length) {
    const fssRes = await pool.query(
      `select f.report_id, f.target_qty, f.actual_qty, p.nrv_usd from report_fss f join products p on p.id=f.product_id where f.report_id = any($1::bigint[])`,
      [reportIds]
    );
    const byReport = {};
    for (const row of fssRes.rows) (byReport[row.report_id] ||= []).push(row);
    history = reportsRes.rows.map((r) => {
      const items = byReport[r.id] || [];
      let target_usd = 0, actual_usd = 0;
      for (const it of items) { target_usd += Number(it.target_qty) * Number(it.nrv_usd); actual_usd += Number(it.actual_qty) * Number(it.nrv_usd); }
      return { report_id: r.id, period: `${r.period_month}/${r.period_year}`, status: r.status, target_usd: Math.round(target_usd), actual_usd: Math.round(actual_usd), achievement: target_usd ? actual_usd / target_usd : null };
    });
  }

  const commentsRes = reportIds.length
    ? await pool.query(
        `select c.*, u.full_name as author_name, r.period_year, r.period_month from report_comments c
         join users u on u.id=c.author_id join reports r on r.id=c.report_id
         where c.report_id = any($1::bigint[]) order by c.created_at desc limit 50`, [reportIds]
      )
    : { rows: [] };

  const salesTrend = await buildAnalyticsContext(pool, { mpIds: [Number(mpId)], label: mpRes.rows[0].full_name });

  const latestApproved = reportsRes.rows.find((r) => r.status === "approved");
  let bonus = null;
  if (latestApproved) {
    bonus = await computeMpQuarterBonus(mpId, latestApproved.period_year, quarterOf(latestApproved.period_month));
  }

  const plansRes = await pool.query(
    "select * from development_plans where mp_id=$1 order by period_year desc, period_month desc limit 12", [mpId]
  );

  // ---- Latest approved report's Conversion / Potential / Sales-forecast snapshot ----
  let latestDetail = null;
  if (latestApproved) {
    const convRes = await pool.query(
      `select c.*, p.name as product_name, p.nrv_usd from report_conversion c join products p on p.id=c.product_id where c.report_id=$1`,
      [latestApproved.id]
    );
    const potRes = await pool.query(
      `select c.*, p.name as product_name, p.nrv_usd from report_potential c join products p on p.id=c.product_id where c.report_id=$1`,
      [latestApproved.id]
    );
    const oppRes = await pool.query("select * from report_opportunities where report_id=$1", [latestApproved.id]);
    latestDetail = {
      period: `${latestApproved.period_month}/${latestApproved.period_year}`,
      conversion_doctors: convRes.rows.length,
      potential_doctors: potRes.rows.length,
      opportunities: oppRes.rows.map((o) => o.name),
    };
  }

  res.json({
    mp: mpRes.rows[0], history, comments: commentsRes.rows,
    monthly: salesTrend?.months || [], quarterly: salesTrend?.quarterly || [], yearly: salesTrend?.yearly || [],
    bonus, plans: plansRes.rows, latestDetail,
  });
});

app.put("/api/development-plans/:mpId", auth, requireRole("rm"), async (req, res) => {
  const { mpId } = req.params;
  if (!(await assertMpAccess(req.user, mpId))) return res.status(403).json({ error: "Forbidden" });
  const { period_year, period_month, strengths, weaknesses, kpis, achieved_kpis, rm_comment } = req.body;
  if (!period_year || !period_month) return res.status(400).json({ error: "Укажите период" });
  await pool.query(
    `insert into development_plans (mp_id, rm_id, period_year, period_month, strengths, weaknesses, kpis, achieved_kpis, rm_comment)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (mp_id, period_year, period_month) do update set
       strengths=excluded.strengths, weaknesses=excluded.weaknesses, kpis=excluded.kpis,
       achieved_kpis=excluded.achieved_kpis, rm_comment=excluded.rm_comment, updated_at=now()`,
    [mpId, req.user.id, period_year, period_month, strengths || "", weaknesses || "", kpis || [], achieved_kpis || [], rm_comment || ""]
  );
  res.json({ ok: true });
});

/* ============================================================
   DASHBOARD — visual org-wide (master) or team (rm) summary
   ============================================================ */
app.get("/api/dashboard", auth, requireRole("master", "rm", "bm"), async (req, res) => {
  let rmsRes;
  if (req.user.role === "rm") {
    rmsRes = await pool.query(
      `select rm.id, rm.full_name, rm.territory from users rm where rm.role='rm' and rm.is_active=true and rm.id = $1 order by rm.full_name`,
      [req.user.id]
    );
  } else if (req.user.role === "bm") {
    rmsRes = await pool.query(
      `select distinct rm.id, rm.full_name, rm.territory from users rm
       join users mp on mp.rm_id = rm.id
       where rm.role='rm' and rm.is_active=true and mp.group_id = $1 and mp.is_active=true
       order by rm.full_name`,
      [req.user.group_id]
    );
  } else {
    rmsRes = await pool.query(`select rm.id, rm.full_name, rm.territory from users rm where rm.role='rm' and rm.is_active=true order by rm.full_name`);
  }

  const hierarchy = [];
  let companyTarget = 0, companyActual = 0, companyBonusUzs = 0, companyConvUsd = 0, companyPotUsd = 0, companyForecastUsd = 0;
  const WEEKS_PER_MONTH_DASH = 4.33;

  for (const rm of rmsRes.rows) {
    const mpsRes = req.user.role === "bm"
      ? await pool.query("select id, full_name, territory from users where rm_id=$1 and role='mp' and is_active=true and group_id=$2 order by full_name", [rm.id, req.user.group_id])
      : await pool.query("select id, full_name, territory from users where rm_id=$1 and role='mp' and is_active=true order by full_name", [rm.id]);
    let rmTarget = 0, rmActual = 0, rmConvUsd = 0, rmPotUsd = 0, rmForecastUsd = 0;
    const mpNodes = [];
    for (const mp of mpsRes.rows) {
      const latestRes = await pool.query(
        "select id, period_year, period_month from reports where mp_id=$1 and status='approved' order by period_year desc, period_month desc limit 1",
        [mp.id]
      );
      const latest = latestRes.rows[0];
      let target_usd = 0, actual_usd = 0, achievement = null, bonus_uzs = 0, conv_usd = 0, pot_usd = 0, forecast_usd = 0;
      if (latest) {
        const fssRes = await pool.query(
          `select f.product_id, f.target_qty, f.actual_qty, p.nrv_usd from report_fss f join products p on p.id=f.product_id where f.report_id=$1`, [latest.id]
        );
        const nrvByProduct = {};
        for (const row of fssRes.rows) {
          target_usd += Number(row.target_qty) * Number(row.nrv_usd);
          actual_usd += Number(row.actual_qty) * Number(row.nrv_usd);
          nrvByProduct[row.product_id] = Number(row.nrv_usd);
        }
        achievement = target_usd ? actual_usd / target_usd : null;
        const quarter = quarterOf(latest.period_month);
        const qb = await computeMpQuarterBonus(mp.id, latest.period_year, quarter);
        bonus_uzs = qb.bonus_uzs;

        // Conversion / Potential additional business, from this MP's latest report
        const convRes = await pool.query("select product_id, current_rx_per_week, target_rx_per_week from report_conversion where report_id=$1", [latest.id]);
        for (const c of convRes.rows) {
          const delta = Math.max(0, Number(c.target_rx_per_week) - Number(c.current_rx_per_week));
          conv_usd += delta * WEEKS_PER_MONTH_DASH * (nrvByProduct[c.product_id] || 0);
        }
        const potRes = await pool.query("select product_id, current_potential_per_week, target_rx_per_week from report_potential where report_id=$1", [latest.id]);
        for (const p of potRes.rows) {
          const delta = Math.max(0, Number(p.target_rx_per_week) - Number(p.current_potential_per_week));
          pot_usd += delta * WEEKS_PER_MONTH_DASH * (nrvByProduct[p.product_id] || 0);
        }
        // Sales expectation forecast (base + conversion + potential + opportunities), in $
        const oppRes = await pool.query("select ov.product_id, ov.qty_packages from report_opportunity_values ov join report_opportunities o on o.id=ov.opportunity_id where o.report_id=$1", [latest.id]);
        let opp_usd = 0;
        for (const o of oppRes.rows) opp_usd += Number(o.qty_packages) * (nrvByProduct[o.product_id] || 0);
        forecast_usd = actual_usd + conv_usd + pot_usd + opp_usd;
      }
      rmTarget += target_usd; rmActual += actual_usd; rmConvUsd += conv_usd; rmPotUsd += pot_usd; rmForecastUsd += forecast_usd;
      mpNodes.push({
        id: mp.id, name: mp.full_name, territory: mp.territory,
        latest_period: latest ? `${latest.period_month}/${latest.period_year}` : null,
        target_usd: Math.round(target_usd), actual_usd: Math.round(actual_usd), achievement, bonus_uzs: Math.round(bonus_uzs),
        conv_usd: Math.round(conv_usd), pot_usd: Math.round(pot_usd), forecast_usd: Math.round(forecast_usd),
      });
    }
    companyTarget += rmTarget; companyActual += rmActual; companyConvUsd += rmConvUsd; companyPotUsd += rmPotUsd; companyForecastUsd += rmForecastUsd;
    companyBonusUzs += mpNodes.reduce((s, m) => s + m.bonus_uzs, 0);
    hierarchy.push({
      id: rm.id, name: rm.full_name, territory: rm.territory,
      target_usd: Math.round(rmTarget), actual_usd: Math.round(rmActual),
      achievement: rmTarget ? rmActual / rmTarget : null,
      conv_usd: Math.round(rmConvUsd), pot_usd: Math.round(rmPotUsd), forecast_usd: Math.round(rmForecastUsd),
      mps: mpNodes,
    });
  }

  res.json({
    hierarchy,
    company: {
      target_usd: Math.round(companyTarget), actual_usd: Math.round(companyActual),
      achievement: companyTarget ? companyActual / companyTarget : null, bonus_uzs: Math.round(companyBonusUzs),
      conv_usd: Math.round(companyConvUsd), pot_usd: Math.round(companyPotUsd), forecast_usd: Math.round(companyForecastUsd),
    },
  });
});

/* ============================================================
   AI INSIGHTS — deep month/quarter/year analysis, runs server-side.
   Requires ANTHROPIC_API_KEY (set once by the company, not per-user).
   ============================================================ */
app.get("/api/ai-insights/status", auth, async (req, res) => {
  res.json({ enabled: aiEnabled, model: aiEnabled ? AI_MODEL : null });
});

const AI_CACHE_HOURS = 24;

// Resolves which MPs/RMs a request should analyze, honoring the caller's
// role-based visibility plus an optional drill-down (mp_id or rm_id) into
// a specific person/team within that visibility. Used by both the main
// analytics endpoint and the Excel/PPTX export endpoints.
async function resolveAiScope(user, { mp_id, rm_id }) {
  let baseMpIds, baseRmIds, groupId = null;

  if (user.role === "mp") {
    baseMpIds = [user.id]; baseRmIds = [];
  } else if (user.role === "rm") {
    const team = await pool.query("select id from users where rm_id=$1 and role='mp' and is_active=true", [user.id]);
    baseMpIds = team.rows.map((r) => r.id); baseRmIds = [];
  } else if (user.role === "bm") {
    groupId = user.group_id;
    const team = await pool.query("select id, rm_id from users where role='mp' and is_active=true and group_id=$1", [groupId]);
    baseMpIds = team.rows.map((r) => r.id);
    baseRmIds = [...new Set(team.rows.map((r) => r.rm_id).filter(Boolean))];
  } else if (user.role === "master") {
    const all = await pool.query("select id from users where role='mp' and is_active=true");
    baseMpIds = all.rows.map((r) => r.id);
    const allRms = await pool.query("select id from users where role='rm' and is_active=true");
    baseRmIds = allRms.rows.map((r) => r.id);
  } else {
    return null;
  }

  // Drill-down into one MP
  if (mp_id) {
    if (!baseMpIds.map(String).includes(String(mp_id))) return { forbidden: true };
    const u = await pool.query("select full_name from users where id=$1", [mp_id]);
    return { scope: "mp_drilldown", scopeId: Number(mp_id), mpIds: [Number(mp_id)], rmIds: [], label: `МП ${u.rows[0]?.full_name || ""}` };
  }
  // Drill-down into one RM's team
  if (rm_id) {
    if (!baseRmIds.map(String).includes(String(rm_id))) return { forbidden: true };
    const teamQuery = groupId
      ? await pool.query("select id from users where rm_id=$1 and role='mp' and is_active=true and group_id=$2", [rm_id, groupId])
      : await pool.query("select id from users where rm_id=$1 and role='mp' and is_active=true", [rm_id]);
    const u = await pool.query("select full_name, territory from users where id=$1", [rm_id]);
    return { scope: "rm_drilldown", scopeId: Number(rm_id), mpIds: teamQuery.rows.map((r) => r.id), rmIds: [], label: `Территория РМ ${u.rows[0]?.full_name || ""}` };
  }

  // Default (no drill-down): the caller's own base scope
  const scope = user.role === "mp" ? "mp" : user.role === "rm" ? "rm" : user.role === "bm" ? "bm" : "master";
  const scopeId = user.role === "master" ? null : user.role === "bm" ? user.group_id : user.id;
  const label = user.role === "mp" ? "Мой отчёт" : user.role === "rm" ? "Вся моя команда" : user.role === "bm" ? "Вся группа (все территории)" : "Вся компания (Узбекистан)";
  return { scope, scopeId, mpIds: baseMpIds, rmIds: baseRmIds, label };
}

async function getOrGenerateAiInsights(resolved, refresh) {
  if (!refresh) {
    const cacheRes = await pool.query(
      `select * from ai_insights where scope=$1 and scope_id ${resolved.scopeId === null ? "is null" : "=$2"} order by created_at desc limit 1`,
      resolved.scopeId === null ? [resolved.scope] : [resolved.scope, resolved.scopeId]
    );
    const cached = cacheRes.rows[0];
    if (cached && (Date.now() - new Date(cached.created_at).getTime()) < AI_CACHE_HOURS * 3600 * 1000) {
      return { ...cached.content, generated_at: cached.created_at, cached: true };
    }
  }

  const context = await buildAnalyticsContext(pool, { mpIds: resolved.mpIds, label: resolved.label, scope: resolved.scope, rmIds: resolved.rmIds });
  if (!context || context.months.length === 0) {
    return { summary: "Недостаточно данных для анализа — нет ни одного одобренного отчёта.", monthly_dynamics: "", quarterly_dynamics: "", yearly_dynamics: "", conversion_potential_analysis: "", navi_analysis: "", risks: [], short_term_recommendations: [], long_term_recommendations: [], team_analysis: [], employee_recommendations: [], business_recommendations: null, chart_data: null, generated_at: new Date(), cached: false };
  }

  const content = await callClaude(context);
  const hasTeam = (context.per_mp && context.per_mp.length > 0) || (context.per_rm && context.per_rm.length > 0);
  let teamContent = { team_analysis: [], employee_recommendations: [], business_recommendations: null };
  if (hasTeam) {
    try {
      teamContent = await callClaudeTeamAnalysis(context);
    } catch (e) {
      console.error("AI insights team analysis error:", e.message);
      teamContent._team_error = "Не удалось получить анализ команды. Попробуйте «Обновить анализ» ещё раз.";
    }
  }

  const chart_data = { months: context.months, quarterly: context.quarterly, yearly: context.yearly, per_mp: context.per_mp, per_rm: context.per_rm };
  const fullContent = { ...content, ...teamContent, chart_data };

  await pool.query(
    "insert into ai_insights (scope, scope_id, content, model) values ($1,$2,$3,$4)",
    [resolved.scope, resolved.scopeId, fullContent, AI_MODEL]
  );
  return { ...fullContent, generated_at: new Date(), cached: false };
}

app.get("/api/ai-insights", auth, async (req, res) => {
  if (!aiEnabled) return res.status(503).json({ error: "ИИ-анализ не настроен на сервере (нет ANTHROPIC_API_KEY)" });
  const resolved = await resolveAiScope(req.user, { mp_id: req.query.mp_id, rm_id: req.query.rm_id });
  if (!resolved) return res.status(403).json({ error: "Forbidden" });
  if (resolved.forbidden) return res.status(403).json({ error: "Нет доступа к этому сотруднику/территории" });

  try {
    const result = await getOrGenerateAiInsights(resolved, req.query.refresh === "true");
    res.json({ ...result, scope_label: resolved.label });
  } catch (e) {
    console.error("AI insights error:", e.message);
    res.status(502).json({ error: "Не удалось получить анализ от ИИ. Попробуйте позже." });
  }
});

// List of people/territories this user can drill into (for the Analytics page's scope picker)
app.get("/api/ai-insights/scopes", auth, async (req, res) => {
  const role = req.user.role;
  if (role === "mp") return res.json({ mps: [], rms: [] });
  let mps = [], rms = [];
  if (role === "rm") {
    const t = await pool.query("select id, full_name, territory from users where rm_id=$1 and role='mp' and is_active=true order by full_name", [req.user.id]);
    mps = t.rows;
  } else if (role === "bm") {
    const t = await pool.query("select id, full_name, territory from users where role='mp' and is_active=true and group_id=$1 order by full_name", [req.user.group_id]);
    mps = t.rows;
    const r = await pool.query(
      `select distinct rm.id, rm.full_name, rm.territory from users rm join users mp on mp.rm_id=rm.id where mp.role='mp' and mp.is_active=true and mp.group_id=$1 order by rm.full_name`,
      [req.user.group_id]
    );
    rms = r.rows;
  } else if (role === "master") {
    const t = await pool.query("select id, full_name, territory from users where role='mp' and is_active=true order by full_name");
    mps = t.rows;
    const r = await pool.query("select id, full_name, territory from users where role='rm' and is_active=true order by full_name");
    rms = r.rows;
  }
  res.json({ mps, rms });
});

/* ---- Analytics export: Excel (styled tables) + PPTX (real charts), same style as report exports ---- */
async function loadAiInsightsForExport(req, res) {
  if (!aiEnabled) { res.status(503).json({ error: "ИИ-анализ не настроен на сервере" }); return null; }
  const resolved = await resolveAiScope(req.user, { mp_id: req.query.mp_id, rm_id: req.query.rm_id });
  if (!resolved) { res.status(403).json({ error: "Forbidden" }); return null; }
  if (resolved.forbidden) { res.status(403).json({ error: "Нет доступа к этому сотруднику/территории" }); return null; }
  const content = await getOrGenerateAiInsights(resolved, false);
  if (!content.chart_data) { res.status(400).json({ error: "Сначала откройте вкладку «Аналитика» и дождитесь генерации анализа" }); return null; }
  return { ...content, scope_label: resolved.label };
}

app.get("/api/ai-insights/export.xlsx", auth, async (req, res) => {
  const data = await loadAiInsightsForExport(req, res);
  if (!data) return;
  try {

  const NAVY = "FF3E4095", GOLD = "FFED3237", GREEN = "FFC6EFCE", GREENFONT = "FF1B5E20", RED = "FFFDE0DF", REDFONT = "FFB71C1C";
  const headerFill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  const headerFont = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  const titleFont = { bold: true, size: 16, color: { argb: NAVY } };
  const thin = { style: "thin", color: { argb: "FFD9DCE1" } };
  const border = { top: thin, bottom: thin, left: thin, right: thin };
  function styleHeaderRow(row) {
    row.eachCell((cell) => { cell.fill = headerFill; cell.font = headerFont; cell.border = border; cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true }; });
    row.height = 22;
  }
  function achFill(pct) {
    if (pct === null || pct === undefined) return null;
    if (pct >= 90) return { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
    if (pct < 80) return { type: "pattern", pattern: "solid", fgColor: { argb: RED } };
    return null;
  }
  function achFont(pct) {
    if (pct === null || pct === undefined) return {};
    if (pct >= 90) return { color: { argb: GREENFONT }, bold: true };
    if (pct < 80) return { color: { argb: REDFONT }, bold: true };
    return {};
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "PULSE";
  const logoId = wb.addImage({ filename: path.join(__dirname, "assets", "msn-logo.png"), extension: "png" });

  const ws1 = wb.addWorksheet("Аналитика", { views: [{ showGridLines: false }] });
  ws1.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 130, height: 68 } });
  ws1.mergeCells("C1:H1");
  ws1.getCell("C1").value = `Аналитика — ${data.scope_label}`;
  ws1.getCell("C1").font = titleFont;
  ws1.getCell("C2").value = `Сформировано: ${new Date(data.generated_at).toLocaleString("ru-RU")}`;
  ws1.getCell("C2").font = { italic: true, color: { argb: "FF6B7280" } };
  let r = 5;
  const textSection = (title, text) => {
    if (!text) return;
    ws1.getCell(`A${r}`).value = title; ws1.getCell(`A${r}`).font = { bold: true, size: 13, color: { argb: NAVY } };
    r += 1;
    ws1.mergeCells(`A${r}:H${r}`);
    ws1.getCell(`A${r}`).value = text; ws1.getCell(`A${r}`).alignment = { wrapText: true, vertical: "top" };
    ws1.getRow(r).height = Math.max(20, Math.ceil(text.length / 110) * 15);
    r += 2;
  };
  textSection("Главный вывод", data.summary);
  textSection("Динамика месяц-к-месяцу", data.monthly_dynamics);
  textSection("Динамика квартал-к-кварталу", data.quarterly_dynamics);
  textSection("Динамика год-к-году", data.yearly_dynamics);
  textSection("Конверсия и увеличение потенциала", data.conversion_potential_analysis);
  textSection("Работа с трудными врачами (NAVI)", data.navi_analysis);
  if (data.risks?.length) textSection("Риски", data.risks.map((x) => `• ${x}`).join("\n"));
  if (data.short_term_recommendations?.length) textSection("Рекомендации: краткосрочно", data.short_term_recommendations.map((x) => `• ${x}`).join("\n"));
  if (data.long_term_recommendations?.length) textSection("Рекомендации: долгосрочно", data.long_term_recommendations.map((x) => `• ${x}`).join("\n"));
  ws1.columns = Array(8).fill({ width: 16 });

  const ws2 = wb.addWorksheet("Динамика по месяцам", { views: [{ showGridLines: false }] });
  styleHeaderRow(ws2.addRow(["Период", "План, $", "Факт, $", "% выполнения", "FFE score, %"]));
  (data.chart_data.months || []).forEach((m) => {
    const row = ws2.addRow([m.period, m.target_usd, m.actual_usd, m.achievement_pct, m.ffe_score_pct]);
    row.getCell(4).fill = achFill(m.achievement_pct); row.getCell(4).font = achFont(m.achievement_pct);
    row.eachCell((c) => (c.border = border));
  });
  ws2.columns.forEach((c) => (c.width = 20));

  if (data.chart_data.quarterly?.length) {
    const ws3 = wb.addWorksheet("Динамика по кварталам", { views: [{ showGridLines: false }] });
    styleHeaderRow(ws3.addRow(["Квартал", "План, $", "Факт, $", "% выполнения"]));
    data.chart_data.quarterly.forEach((q) => {
      const row = ws3.addRow([q.period, q.target_usd, q.actual_usd, q.achievement_pct]);
      row.getCell(4).fill = achFill(q.achievement_pct); row.getCell(4).font = achFont(q.achievement_pct);
      row.eachCell((c) => (c.border = border));
    });
    ws3.columns.forEach((c) => (c.width = 20));
  }

  if (data.chart_data.per_mp?.length) {
    const ws4 = wb.addWorksheet("По медпредставителям", { views: [{ showGridLines: false }] });
    styleHeaderRow(ws4.addRow(["МП", "Территория", "Последнее выполнение, %", "Среднее выполнение, %", "Отчётов подано"]));
    data.chart_data.per_mp.forEach((m) => {
      const row = ws4.addRow([m.name, m.territory, m.latest_achievement_pct, m.avg_achievement_pct, m.months_reported]);
      row.getCell(3).fill = achFill(m.latest_achievement_pct); row.getCell(3).font = achFont(m.latest_achievement_pct);
      row.eachCell((c) => (c.border = border));
    });
    ws4.columns.forEach((c) => (c.width = 22));
    if (data.team_analysis?.length || data.employee_recommendations?.length) {
      ws4.addRow([]);
      const t2 = ws4.addRow(["Анализ и рекомендации по сотрудникам"]); t2.font = titleFont;
      styleHeaderRow(ws4.addRow(["Имя", "Роль", "Оценка", "Рекомендация: месяц", "Рекомендация: квартал", "Рекомендация: год"]));
      const recByName = Object.fromEntries((data.employee_recommendations || []).map((e) => [e.name, e]));
      (data.team_analysis || []).forEach((p) => {
        const rec = recByName[p.name] || {};
        const row = ws4.addRow([p.name, p.role, p.assessment, rec.monthly, rec.quarterly, rec.yearly]);
        row.eachCell((c) => { c.border = border; c.alignment = { wrapText: true, vertical: "top" }; });
        row.height = 60;
      });
    }
  }

  if (data.chart_data.per_rm?.length) {
    const ws5 = wb.addWorksheet("По региональным менеджерам", { views: [{ showGridLines: false }] });
    styleHeaderRow(ws5.addRow(["РМ", "Территория", "Кол-во МП", "Средний % команды"]));
    data.chart_data.per_rm.forEach((m) => {
      const row = ws5.addRow([m.name, m.territory, m.mp_count, m.team_avg_achievement_pct]);
      row.getCell(4).fill = achFill(m.team_avg_achievement_pct); row.getCell(4).font = achFont(m.team_avg_achievement_pct);
      row.eachCell((c) => (c.border = border));
    });
    ws5.columns.forEach((c) => (c.width = 22));
  }

  if (data.business_recommendations) {
    const ws6 = wb.addWorksheet("Рекомендации по бизнесу", { views: [{ showGridLines: false }] });
    ws6.getCell("A1").value = "Рекомендации по развитию бизнеса"; ws6.getCell("A1").font = titleFont;
    ["monthly", "quarterly", "yearly"].forEach((k, i) => {
      const label = k === "monthly" ? "Месяц" : k === "quarterly" ? "Квартал" : "Год";
      ws6.getCell(`A${3 + i * 3}`).value = label; ws6.getCell(`A${3 + i * 3}`).font = { bold: true, color: { argb: NAVY } };
      ws6.mergeCells(`A${4 + i * 3}:H${4 + i * 3}`);
      ws6.getCell(`A${4 + i * 3}`).value = data.business_recommendations[k]; ws6.getCell(`A${4 + i * 3}`).alignment = { wrapText: true };
      ws6.getRow(4 + i * 3).height = 60;
    });
    ws6.columns = Array(8).fill({ width: 16 });
  }

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(analyticsExportFilename(data, "xlsx"))}"`);
  await wb.xlsx.write(res);
  res.end();
  } catch (e) {
    console.error("Analytics xlsx export failed:", e.message, e.stack);
    if (!res.headersSent) res.status(500).json({ error: "Ошибка при формировании Excel: " + e.message });
    else res.end();
  }
});

app.get("/api/ai-insights/export.pptx", auth, async (req, res) => {
  const data = await loadAiInsightsForExport(req, res);
  if (!data) return;
  try {

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE", width: 13.33, height: 7.5 });
  pptx.layout = "WIDE";
  const BG = "FFFFFF", INK = "1F2937", MUTED = "6B7280", NAVY = "3E4095", GOLD = "ED3237", GREEN = "16A34A", RED = "DC2626", PANEL = "F7F8FC", LINE = "E4E7F0", ACCENT = "ED3237";
  const MSN_LOGO = path.join(__dirname, "assets", "msn-logo.png");

  function chrome(s, title) {
    s.background = { color: BG };
    s.addImage({ path: MSN_LOGO, x: 11.7, y: 0.25, w: 1.2, h: 0.6, sizing: { type: "contain", w: 1.2, h: 0.6 } });
    s.addText(title, { x: 0.5, y: 0.3, fontSize: 22, bold: true, color: NAVY, fontFace: "Arial" });
    s.addShape(pptx.ShapeType.line, { x: 0.5, y: 0.9, w: 10.8, h: 0, line: { color: ACCENT, width: 2 } });
  }
  function achColor(pct) { if (pct === null || pct === undefined) return MUTED; return pct >= 90 ? GREEN : pct < 80 ? RED : ACCENT; }
  function textSlide(title, text) {
    if (!text) return;
    const s = pptx.addSlide(); chrome(s, title);
    s.addText(text, { x: 0.5, y: 1.1, w: 12.3, h: 5.8, fontSize: 14, color: INK, valign: "top", fontFace: "Arial" });
  }
  function listSlide(title, items, color) {
    if (!items?.length) return;
    const s = pptx.addSlide(); chrome(s, title);
    const bullets = items.map((it) => ({ text: it, options: { bullet: true, color: color || INK, breakLine: true, fontSize: 13 } }));
    s.addText(bullets, { x: 0.5, y: 1.1, w: 12.3, h: 5.8, valign: "top", fontFace: "Arial" });
  }

  // ---- Cover ----
  let s = pptx.addSlide();
  s.background = { color: BG };
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: PANEL } });
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.18, h: 7.5, fill: { color: ACCENT } });
  s.addImage({ path: MSN_LOGO, x: 0.9, y: 0.6, w: 2.4, h: 1.2, sizing: { type: "contain", w: 2.4, h: 1.2 } });
  s.addText("Аналитика", { x: 0.9, y: 2.6, w: 11.5, h: 1, fontSize: 34, bold: true, color: NAVY, fontFace: "Arial" });
  s.addText(data.scope_label, { x: 0.9, y: 3.5, w: 11.5, h: 0.6, fontSize: 18, color: ACCENT, bold: true, fontFace: "Arial" });
  s.addText(`Сформировано: ${new Date(data.generated_at).toLocaleString("ru-RU")}`, { x: 0.9, y: 4.05, w: 11.5, h: 0.5, fontSize: 14, color: MUTED, fontFace: "Arial" });

  textSlide("Главный вывод", data.summary);

  if (data.chart_data.months?.length) {
    s = pptx.addSlide(); chrome(s, "Динамика месяц-к-месяцу");
    s.addChart(pptx.ChartType.bar, [
      { name: "План, $", labels: data.chart_data.months.map((m) => m.period), values: data.chart_data.months.map((m) => m.target_usd) },
      { name: "Факт, $", labels: data.chart_data.months.map((m) => m.period), values: data.chart_data.months.map((m) => m.actual_usd) },
    ], { x: 0.5, y: 1.0, w: 12.3, h: 3.2, barGrouping: "clustered", chartColors: ["D3D8E4", ACCENT], showLegend: true, catAxisLabelColor: MUTED, valAxisLabelColor: MUTED });
    s.addText(data.monthly_dynamics || "", { x: 0.5, y: 4.4, w: 12.3, h: 2.6, fontSize: 11, color: INK, valign: "top", fontFace: "Arial" });
  }

  if (data.chart_data.quarterly?.length) {
    s = pptx.addSlide(); chrome(s, "Динамика квартал-к-кварталу");
    s.addChart(pptx.ChartType.line, [
      { name: "% выполнения", labels: data.chart_data.quarterly.map((q) => q.period), values: data.chart_data.quarterly.map((q) => q.achievement_pct) },
    ], { x: 0.5, y: 1.0, w: 12.3, h: 3.2, chartColors: [NAVY], showLegend: false, catAxisLabelColor: MUTED, valAxisLabelColor: MUTED, lineDataSymbol: "circle" });
    s.addText(data.quarterly_dynamics || "", { x: 0.5, y: 4.4, w: 12.3, h: 2.6, fontSize: 11, color: INK, valign: "top", fontFace: "Arial" });
  }

  textSlide("Динамика год-к-году", data.yearly_dynamics);
  textSlide("Конверсия и увеличение потенциала", data.conversion_potential_analysis);
  textSlide("Работа с трудными врачами (NAVI)", data.navi_analysis);
  listSlide("Риски", data.risks, RED);
  listSlide("Рекомендации: краткосрочно (1-4 недели)", data.short_term_recommendations, ACCENT);
  listSlide("Рекомендации: долгосрочно (квартал+)", data.long_term_recommendations, GREEN);

  if (data.chart_data.per_mp?.length) {
    s = pptx.addSlide(); chrome(s, "Эффективность команды: медпредставители");
    s.addChart(pptx.ChartType.bar, [
      { name: "% выполнения", labels: data.chart_data.per_mp.map((m) => m.name), values: data.chart_data.per_mp.map((m) => m.latest_achievement_pct || 0) },
    ], { x: 0.5, y: 1.0, w: 12.3, h: 5.6, barDir: "bar", chartColors: data.chart_data.per_mp.map((m) => achColor(m.latest_achievement_pct)), showLegend: false, showValue: true, catAxisLabelColor: MUTED, valAxisLabelColor: MUTED, valAxisMinVal: 0, valAxisMaxVal: 100 });
  }
  if (data.chart_data.per_rm?.length) {
    s = pptx.addSlide(); chrome(s, "Эффективность команды: региональные менеджеры");
    s.addChart(pptx.ChartType.bar, [
      { name: "Средний % команды", labels: data.chart_data.per_rm.map((m) => m.name), values: data.chart_data.per_rm.map((m) => m.team_avg_achievement_pct || 0) },
    ], { x: 0.5, y: 1.0, w: 12.3, h: 5.6, barDir: "bar", chartColors: data.chart_data.per_rm.map((m) => achColor(m.team_avg_achievement_pct)), showLegend: false, showValue: true, catAxisLabelColor: MUTED, valAxisLabelColor: MUTED, valAxisMinVal: 0, valAxisMaxVal: 100 });
  }

  (data.team_analysis || []).forEach((p) => {
    const rec = (data.employee_recommendations || []).find((e) => e.name === p.name);
    s = pptx.addSlide(); chrome(s, `${p.name} (${p.role})`);
    s.addText("Оценка эффективности", { x: 0.5, y: 1.0, fontSize: 13, bold: true, color: NAVY, fontFace: "Arial" });
    s.addText(p.assessment || "", { x: 0.5, y: 1.4, w: 12.3, h: 1.6, fontSize: 12, color: INK, valign: "top", fontFace: "Arial" });
    if (rec) {
      const recRows = [[
        { text: "Месяц", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
        { text: "Квартал", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
        { text: "Год", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
      ], [
        { text: rec.monthly || "—", options: { color: INK, valign: "top" } },
        { text: rec.quarterly || "—", options: { color: INK, valign: "top" } },
        { text: rec.yearly || "—", options: { color: INK, valign: "top" } },
      ]];
      s.addTable(recRows, { x: 0.5, y: 3.2, w: 12.3, h: 3.5, fontSize: 11, border: { color: LINE, pt: 0.5 }, autoPage: false, valign: "top" });
    }
  });

  if (data.business_recommendations) {
    s = pptx.addSlide(); chrome(s, "Рекомендации по развитию бизнеса");
    const bizRows = [[
      { text: "Месяц", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
      { text: "Квартал", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
      { text: "Год", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
    ], [
      { text: data.business_recommendations.monthly || "—", options: { color: INK, valign: "top" } },
      { text: data.business_recommendations.quarterly || "—", options: { color: INK, valign: "top" } },
      { text: data.business_recommendations.yearly || "—", options: { color: INK, valign: "top" } },
    ]];
    s.addTable(bizRows, { x: 0.5, y: 1.1, w: 12.3, h: 5.5, fontSize: 12, border: { color: LINE, pt: 0.5 }, autoPage: false, valign: "top" });
  }

  const buffer = await pptx.write({ outputType: "nodebuffer" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(analyticsExportFilename(data, "pptx"))}"`);
  res.end(buffer);
  } catch (e) {
    console.error("Analytics pptx export failed:", e.message, e.stack);
    if (!res.headersSent) res.status(500).json({ error: "Ошибка при формировании PPTX: " + e.message });
    else res.end();
  }
});

/* ============================================================
   EXPORTS — available once status = 'approved'
   ============================================================ */
async function loadFullReport(rid) {
  const rRes = await pool.query("select * from reports where id=$1", [rid]);
  const report = rRes.rows[0];
  if (!report) return null;
  const mpRes = await pool.query("select id, full_name, territory, rm_id from users where id=$1", [report.mp_id]);
  const rmRes = mpRes.rows[0]?.rm_id
    ? await pool.query("select full_name from users where id=$1", [mpRes.rows[0].rm_id])
    : { rows: [] };
  const fssRes = await pool.query(
    `select f.*, p.name as product_name, p.nrv_usd from report_fss f
     join products p on p.id=f.product_id where f.report_id=$1 order by p.sort_order`, [rid]);
  const ffeRes = await pool.query("select * from report_ffe where report_id=$1", [rid]);
  const apRes = await pool.query("select * from report_action_plan where report_id=$1 order by sort_order,id", [rid]);
  const convRes = await pool.query(
    `select c.*, p.name as product_name, p.nrv_usd from report_conversion c join products p on p.id=c.product_id where c.report_id=$1`, [rid]);
  const potRes = await pool.query(
    `select c.*, p.name as product_name, p.nrv_usd from report_potential c join products p on p.id=c.product_id where c.report_id=$1`, [rid]);
  const commentsRes = await pool.query(
    `select cm.*, u.full_name as author_name from report_comments cm join users u on u.id=cm.author_id where cm.report_id=$1 order by cm.created_at`, [rid]);

  // DOC TRACKING — this MP's tracked doctors' indicator-pharmacy contribution for the report's month
  const docLogRes = await pool.query(
    `select td.id as doctor_id, td.full_name as doctor_name, td.event_name, l.qty_packages, p.nrv_usd, p.name as product_name
     from tracked_doctors td
     join doctor_weekly_log l on l.doctor_id = td.id
     join products p on p.id = l.product_id
     where td.mp_id = $1 and extract(year from l.log_date) = $2 and extract(month from l.log_date) = $3`,
    [report.mp_id, report.period_year, report.period_month]
  );
  const docTrackingByDoctor = {};
  for (const r of docLogRes.rows) {
    const usd = Number(r.qty_packages) * Number(r.nrv_usd);
    docTrackingByDoctor[r.doctor_id] ||= { doctor_name: r.doctor_name, event_name: r.event_name, qty: 0, usd: 0 };
    docTrackingByDoctor[r.doctor_id].qty += Number(r.qty_packages);
    docTrackingByDoctor[r.doctor_id].usd += usd;
  }
  const docTracking = Object.values(docTrackingByDoctor);

  // Group by event/conference, for the DOC TRACKING slide
  const docTrackingByEvent = {};
  for (const d of docTracking) {
    const key = d.event_name || "Без мероприятия";
    docTrackingByEvent[key] ||= { event_name: key, doctors: [], qty: 0, usd: 0 };
    docTrackingByEvent[key].doctors.push(d);
    docTrackingByEvent[key].qty += d.qty;
    docTrackingByEvent[key].usd += d.usd;
  }
  const docTrackingGrouped = Object.values(docTrackingByEvent);

  let targetUsd = 0, actualUsd = 0;
  const fssItems = fssRes.rows.map((r) => {
    const t = Number(r.target_qty) * Number(r.nrv_usd);
    const a = Number(r.actual_qty) * Number(r.nrv_usd);
    targetUsd += t; actualUsd += a;
    return { ...r, target_usd: t, actual_usd: a };
  });
  const achievement = targetUsd === 0 ? 0 : actualUsd / targetUsd;
  const rawBonusUzs = bonusFor(achievement, Number(report.base_rate_uzs));

  const ffeItems = ffeRes.rows.map((r) => {
    const denom = r.approved_count > 0 ? r.approved_count : r.master_list_count;
    const pct = denom > 0 ? r.achieved_count / denom : 0;
    return { ...r, label: FFE_LABELS[r.metric_key], percent: pct };
  });
  const ffeScore = ffeItems.length ? ffeItems.reduce((s, x) => s + x.percent, 0) / ffeItems.length : 0;
  const ffeGatePassed = ffeScore >= FFE_GATE;
  const bonusUzs = (ffeGatePassed && report.non_reimbursement_ok) ? rawBonusUzs : 0;
  const quarterBonus = await computeMpQuarterBonus(report.mp_id, report.period_year, quarterOf(report.period_month));

  // ---- Sales forecast for next month (base + conversion + potential + opportunities) ----
  const WEEKS_PER_MONTH_EXP = 4.33;
  const nrvByProduct = Object.fromEntries(fssItems.map((it) => [it.product_id, Number(it.nrv_usd)]));
  function packsImpact(rows, currentField) {
    const byProduct = {};
    for (const r of rows) {
      const delta = Math.max(0, Number(r.target_rx_per_week) - Number(r[currentField]));
      byProduct[r.product_id] = (byProduct[r.product_id] || 0) + delta * WEEKS_PER_MONTH_EXP;
    }
    return byProduct;
  }
  const convPacks = packsImpact(convRes.rows, "current_rx_per_week");
  const potPacks = packsImpact(potRes.rows, "current_potential_per_week");

  // ---- Per-SKU breakdown for the Conversion / Potential slides ----
  function skuBreakdown(packsByProduct) {
    const rows = Object.entries(packsByProduct)
      .map(([pid, packs]) => ({ product_name: nameByProduct[pid] || "—", packs, usd: packs * (nrvByProduct[pid] || 0) }))
      .filter((r) => r.packs > 0)
      .sort((a, b) => b.usd - a.usd);
    const totalPacks = rows.reduce((s, r) => s + r.packs, 0);
    const totalUsd = rows.reduce((s, r) => s + r.usd, 0);
    return { rows, totalPacks, totalUsd };
  }
  const nameByProduct = Object.fromEntries(fssItems.map((it) => [it.product_id, it.product_name]));
  const conversionSkuBreakdown = skuBreakdown(convPacks);
  const potentialSkuBreakdown = skuBreakdown(potPacks);

  // ---- Plan vs Actual for THIS month (plan was set last month, MP now reports the result) ----
  function buildPlanVsActualExport(rows) {
    const byProduct = {};
    for (const r of rows) {
      if (r.previous_target_rx_per_week === null || r.previous_target_rx_per_week === undefined) continue;
      const pid = r.product_id;
      if (!byProduct[pid]) byProduct[pid] = { product_name: r.product_name, nrv_usd: Number(r.nrv_usd), plan_rx: 0, fact_rx: 0 };
      const plan = Number(r.previous_target_rx_per_week);
      const fact = r.actual_result_rx_per_week === null || r.actual_result_rx_per_week === undefined ? 0 : Number(r.actual_result_rx_per_week);
      byProduct[pid].plan_rx += plan;
      byProduct[pid].fact_rx += fact;
    }
    const items = Object.values(byProduct).map((b) => ({
      product_name: b.product_name,
      plan_packs: b.plan_rx * WEEKS_PER_MONTH_EXP, fact_packs: b.fact_rx * WEEKS_PER_MONTH_EXP,
      plan_usd: b.plan_rx * WEEKS_PER_MONTH_EXP * b.nrv_usd, fact_usd: b.fact_rx * WEEKS_PER_MONTH_EXP * b.nrv_usd,
      achievement: b.plan_rx ? b.fact_rx / b.plan_rx : null,
    }));
    const totalPlanUsd = items.reduce((s, it) => s + it.plan_usd, 0);
    const totalFactUsd = items.reduce((s, it) => s + it.fact_usd, 0);
    return { items, totalPlanUsd, totalFactUsd, achievement: totalPlanUsd ? totalFactUsd / totalPlanUsd : null };
  }
  const conversionPlanVsActual = buildPlanVsActualExport(convRes.rows);
  const potentialPlanVsActual = buildPlanVsActualExport(potRes.rows);

  // ---- Marketing events & activities: plan vs actual for this report's month ----
  const activityRes = await pool.query(
    `select e.*, t.name as type_name, t.category as kind_category
     from activity_entries e join activity_types t on t.id=e.activity_type_id
     where e.mp_id=$1 and e.period_year=$2 and e.period_month=$3`,
    [report.mp_id, report.period_year, report.period_month]
  );
  const activitiesByType = {};
  for (const r of activityRes.rows) {
    const key = `${r.kind_category}:${r.type_name}`;
    activitiesByType[key] ||= { kind: r.kind_category, type_name: r.type_name, planned: 0, completed: 0 };
    activitiesByType[key].planned += 1;
    if (r.status === "completed") activitiesByType[key].completed += 1;
  }
  const activitiesSummary = Object.values(activitiesByType);

  const nextMonth = report.period_month === 12 ? 1 : report.period_month + 1;
  const nextYear = report.period_month === 12 ? report.period_year + 1 : report.period_year;
  const oppRes = await pool.query("select * from report_opportunities where report_id=$1", [rid]);
  const oppValuesRes = oppRes.rows.length
    ? await pool.query("select * from report_opportunity_values where opportunity_id = any($1::bigint[])", [oppRes.rows.map((o) => o.id)])
    : { rows: [] };
  const oppPacks = {};
  for (const v of oppValuesRes.rows) oppPacks[v.product_id] = (oppPacks[v.product_id] || 0) + Number(v.qty_packages);

  const nextReportRes = await pool.query("select id from reports where mp_id=$1 and period_year=$2 and period_month=$3", [report.mp_id, nextYear, nextMonth]);
  let nextTargetUsdByProduct = {};
  if (nextReportRes.rows[0]) {
    const nf = await pool.query(`select f.product_id, f.target_qty, p.nrv_usd from report_fss f join products p on p.id=f.product_id where f.report_id=$1`, [nextReportRes.rows[0].id]);
    for (const r of nf.rows) nextTargetUsdByProduct[r.product_id] = Number(r.target_qty) * Number(r.nrv_usd);
  }
  const forecast = fssItems.map((it) => {
    const base_packs = Number(it.actual_qty);
    const total_packs = base_packs + (convPacks[it.product_id] || 0) + (potPacks[it.product_id] || 0) + (oppPacks[it.product_id] || 0);
    const total_usd = total_packs * Number(it.nrv_usd);
    return { product_name: it.product_name, base_packs, total_packs, total_usd, next_target_usd: nextTargetUsdByProduct[it.product_id] || 0 };
  });
  const forecastTotalUsd = forecast.reduce((s, f) => s + f.total_usd, 0);
  const forecastTargetUsd = forecast.reduce((s, f) => s + f.next_target_usd, 0);

  // Latest cached Analytics for this MP (if the MP has ever opened the Аналитика tab) — the
  // business review report includes this summary, but never triggers a fresh AI call on its own.
  const analyticsRes = await pool.query(
    "select content, created_at from ai_insights where scope='mp' and scope_id=$1 order by created_at desc limit 1",
    [report.mp_id]
  );
  const analytics = analyticsRes.rows[0] ? { ...analyticsRes.rows[0].content, generated_at: analyticsRes.rows[0].created_at } : null;

  return {
    report, mp: mpRes.rows[0], rm_name: rmRes.rows[0]?.full_name || "—",
    fssItems, targetUsd, actualUsd, achievement, rawBonusUzs, bonusUzs, bonusUsd: bonusUzs / Number(report.fx_rate),
    ffeItems, ffeScore, ffeGatePassed, actionPlan: apRes.rows, conversion: convRes.rows, potential: potRes.rows,
    conversionSkuBreakdown, potentialSkuBreakdown, conversionPlanVsActual, potentialPlanVsActual, activitiesSummary,
    comments: commentsRes.rows, quarterBonus, docTracking, docTrackingGrouped,
    forecast, forecastTotalUsd, forecastTargetUsd, forecastPeriod: { year: nextYear, month: nextMonth },
    opportunities: oppRes.rows.map((o) => o.name),
    analytics,
  };
}

async function checkExportAccess(req, res, rid) {
  const rRes = await pool.query("select * from reports where id=$1", [rid]);
  const report = rRes.rows[0];
  if (!report) { res.status(404).json({ error: "Не найдено" }); return null; }
  if (!(await canAccessReport(req.user, report))) { res.status(403).json({ error: "Forbidden" }); return null; }
  if (report.status !== "approved") { res.status(409).json({ error: "Отчёт ещё не одобрен — скачивание станет доступно после одобрения РМ" }); return null; }
  return report;
}

app.get("/api/reports/:id/export/xlsx", auth, async (req, res) => {
  const rid = req.params.id;
  const report = await checkExportAccess(req, res, rid);
  if (!report) return;
  const data = await loadFullReport(rid);

  const NAVY = "FF3E4095", GOLD = "FFED3237", GREEN = "FFC6EFCE", GREENFONT = "FF1B5E20", RED = "FFFDE0DF", REDFONT = "FFB71C1C", LIGHT = "FFF7F8FA";
  const headerFill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  const headerFont = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  const titleFont = { bold: true, size: 16, color: { argb: NAVY } };
  const thin = { style: "thin", color: { argb: "FFD9DCE1" } };
  const border = { top: thin, bottom: thin, left: thin, right: thin };

  function styleHeaderRow(row) {
    row.eachCell((cell) => { cell.fill = headerFill; cell.font = headerFont; cell.border = border; cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true }; });
    row.height = 22;
  }
  function achievementFill(pct) {
    if (pct === null || pct === undefined) return null;
    if (pct >= 0.9) return { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
    if (pct < 0.8) return { type: "pattern", pattern: "solid", fgColor: { argb: RED } };
    return null;
  }
  function achievementFont(pct) {
    if (pct === null || pct === undefined) return {};
    if (pct >= 0.9) return { color: { argb: GREENFONT }, bold: true };
    if (pct < 0.8) return { color: { argb: REDFONT }, bold: true };
    return {};
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "FSS Review Platform";
  const logoId = wb.addImage({ filename: path.join(__dirname, "assets", "msn-logo.png"), extension: "png" });

  const ws1 = wb.addWorksheet("FSS", { views: [{ showGridLines: false }] });
  ws1.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 130, height: 68 } });
  ws1.mergeCells("C1:I1");
  ws1.getCell("C1").value = `Отчёт FSS — ${data.mp.full_name}`;
  ws1.getCell("C1").font = titleFont;
  ws1.getCell("C2").value = `Территория: ${data.mp.territory || "—"}   ·   РМ: ${data.rm_name}   ·   Период: ${data.report.period_month}/${data.report.period_year}`;
  ws1.getCell("C2").font = { italic: true, color: { argb: "FF6B7280" } };
  ws1.getRow(1).height = 40;
  ws1.addRow([]);
  const h1 = ws1.addRow(["Препарат", "NRV $", "План, уп.", "Факт, уп.", "План, $", "Факт, $", "Дост., %"]);
  styleHeaderRow(h1);
  data.fssItems.forEach((it) => {
    const pct = it.target_usd ? it.actual_usd / it.target_usd : null;
    const row = ws1.addRow([it.product_name, Number(it.nrv_usd), Number(it.target_qty), Number(it.actual_qty), it.target_usd, it.actual_usd, pct]);
    row.getCell(2).numFmt = '$#,##0.00';
    row.getCell(5).numFmt = '$#,##0'; row.getCell(6).numFmt = '$#,##0'; row.getCell(7).numFmt = '0.0%';
    row.eachCell((c) => (c.border = border));
    if (pct !== null) { row.getCell(7).fill = achievementFill(pct); row.getCell(7).font = achievementFont(pct); }
  });
  ws1.addRow([]);
  const totalRow = ws1.addRow(["ИТОГО", "", "", "", data.targetUsd, data.actualUsd, data.achievement]);
  totalRow.font = { bold: true };
  totalRow.getCell(5).numFmt = '$#,##0'; totalRow.getCell(6).numFmt = '$#,##0'; totalRow.getCell(7).numFmt = '0.0%';
  totalRow.getCell(7).fill = achievementFill(data.achievement);
  ws1.addRow([]);
  ws1.addRow(["Расчётный бонус (по FSS), UZS", Math.round(data.rawBonusUzs)]);
  const ffeGateRow = ws1.addRow(["FFE gate (≥85%)", data.ffeGatePassed ? "пройден ✓" : "НЕ пройден — бонус обнулён"]);
  ffeGateRow.getCell(2).font = { color: { argb: data.ffeGatePassed ? GREENFONT : REDFONT }, bold: true };
  const nrRow = ws1.addRow(["Non-reimbursement условие (≥50%)", data.report.non_reimbursement_ok ? "подтверждено ✓" : "НЕ подтверждено — бонус обнулён"]);
  nrRow.getCell(2).font = { color: { argb: data.report.non_reimbursement_ok ? GREENFONT : REDFONT }, bold: true };
  const finalBonusRow = ws1.addRow(["ИТОГОВЫЙ бонус, UZS / $", `${Math.round(data.bonusUzs).toLocaleString()} / $${Math.round(data.bonusUsd).toLocaleString()}`]);
  finalBonusRow.font = { bold: true, size: 12, color: { argb: NAVY } };
  ws1.getColumn(1).width = 32; ws1.getColumn(2).width = 14; ws1.getColumn(3).width = 12; ws1.getColumn(4).width = 12; ws1.getColumn(5).width = 14; ws1.getColumn(6).width = 14; ws1.getColumn(7).width = 12;
  ws1.views = [{ state: "frozen", ySplit: 4 }];

  const ws2 = wb.addWorksheet("FFE", { views: [{ showGridLines: false }] });
  const h2 = ws2.addRow(["Метрика", "База", "Утверждено", "Достигнуто", "%"]);
  styleHeaderRow(h2);
  data.ffeItems.forEach((it) => {
    const row = ws2.addRow([it.label, it.master_list_count, it.approved_count, it.achieved_count, it.percent]);
    row.getCell(5).numFmt = '0.0%';
    row.eachCell((c) => (c.border = border));
    row.getCell(5).fill = achievementFill(it.percent); row.getCell(5).font = achievementFont(it.percent);
  });
  ws2.addRow([]);
  const ffeScoreRow = ws2.addRow(["Общий FFE score", "", "", "", data.ffeScore]);
  ffeScoreRow.font = { bold: true }; ffeScoreRow.getCell(5).numFmt = '0.0%';
  ws2.addRow(["Порог допуска к бонусу", "", "", "", 0.85]).getCell(5).numFmt = '0.0%';
  ws2.getColumn(1).width = 34; [2, 3, 4, 5].forEach((i) => (ws2.getColumn(i).width = 14));

  const ws3 = wb.addWorksheet("Action Plan", { views: [{ showGridLines: false }] });
  styleHeaderRow(ws3.addRow(["Препарат", "Цель", "План действий", "Контрольная дата", "Дата завершения"]));
  data.actionPlan.forEach((it) => { const row = ws3.addRow([it.product_name, it.goal, it.action_text, it.control_date, it.completion_date]); row.eachCell((c) => (c.border = border)); });
  ws3.columns.forEach((c) => (c.width = 28));

  const ws4 = wb.addWorksheet("Конверсия", { views: [{ showGridLines: false }] });
  styleHeaderRow(ws4.addRow(["Препарат", "Врач", "Специальность", "ЛПУ", "Наш преп., Rx/нед", "Конкуренты, Rx/нед", "Почему конкуренты", "План МП", "Цель, Rx/нед", "Начало", "Контроль"]));
  data.conversion.forEach((it) => {
    const row = ws4.addRow([it.product_name, it.doctor_name, it.doctor_specialty, it.lpu_name, Number(it.current_rx_per_week), Number(it.competitor_rx_per_week), it.competitor_reason, it.mp_action_plan, Number(it.target_rx_per_week), it.start_date, it.control_date]);
    row.eachCell((c) => (c.border = border));
  });
  ws4.columns.forEach((c) => (c.width = 22));
  if (data.conversionPlanVsActual.items.length > 0) {
    ws4.addRow([]);
    const pvaTitle = ws4.addRow(["Итоги плана конверсии за этот месяц: план (прошлый месяц) vs факт"]);
    pvaTitle.font = titleFont;
    styleHeaderRow(ws4.addRow(["Препарат", "План, уп.", "Факт, уп.", "План, $", "Факт, $", "Выполнение"]));
    data.conversionPlanVsActual.items.forEach((it) => {
      const row = ws4.addRow([it.product_name, Math.round(it.plan_packs), Math.round(it.fact_packs), Math.round(it.plan_usd), Math.round(it.fact_usd), it.achievement]);
      row.getCell(6).numFmt = "0.0%";
      row.eachCell((c) => (c.border = border));
    });
    const pvaTotal = ws4.addRow(["ИТОГО", "", "", Math.round(data.conversionPlanVsActual.totalPlanUsd), Math.round(data.conversionPlanVsActual.totalFactUsd), data.conversionPlanVsActual.achievement]);
    pvaTotal.font = { bold: true };
    pvaTotal.getCell(6).numFmt = "0.0%";
  }

  const ws5 = wb.addWorksheet("Увеличение потенциала", { views: [{ showGridLines: false }] });
  styleHeaderRow(ws5.addRow(["Препарат", "Врач", "Специальность", "ЛПУ", "Текущий потенциал, Rx/нед", "Причина", "План МП", "Цель, Rx/нед", "Начало", "Контроль"]));
  data.potential.forEach((it) => {
    const row = ws5.addRow([it.product_name, it.doctor_name, it.doctor_specialty, it.lpu_name, Number(it.current_potential_per_week), it.reason_not_treating, it.mp_action_plan, Number(it.target_rx_per_week), it.start_date, it.control_date]);
    row.eachCell((c) => (c.border = border));
  });
  ws5.columns.forEach((c) => (c.width = 22));
  if (data.potentialPlanVsActual.items.length > 0) {
    ws5.addRow([]);
    const pvaTitle2 = ws5.addRow(["Итоги плана увеличения потенциала за этот месяц: план (прошлый месяц) vs факт"]);
    pvaTitle2.font = titleFont;
    styleHeaderRow(ws5.addRow(["Препарат", "План, уп.", "Факт, уп.", "План, $", "Факт, $", "Выполнение"]));
    data.potentialPlanVsActual.items.forEach((it) => {
      const row = ws5.addRow([it.product_name, Math.round(it.plan_packs), Math.round(it.fact_packs), Math.round(it.plan_usd), Math.round(it.fact_usd), it.achievement]);
      row.getCell(6).numFmt = "0.0%";
      row.eachCell((c) => (c.border = border));
    });
    const pvaTotal2 = ws5.addRow(["ИТОГО", "", "", Math.round(data.potentialPlanVsActual.totalPlanUsd), Math.round(data.potentialPlanVsActual.totalFactUsd), data.potentialPlanVsActual.achievement]);
    pvaTotal2.font = { bold: true };
    pvaTotal2.getCell(6).numFmt = "0.0%";
  }

  const ws6 = wb.addWorksheet("DOC TRACKING", { views: [{ showGridLines: false }] });
  styleHeaderRow(ws6.addRow(["Врач", "Мероприятие (конференция)", "Упаковок за месяц", "Вклад, $"]));
  data.docTracking.forEach((it) => {
    const row = ws6.addRow([it.doctor_name, it.event_name, Math.round(it.qty), Math.round(it.usd)]);
    row.eachCell((c) => (c.border = border));
  });
  if (data.docTracking.length > 0) {
    const totalRow = ws6.addRow(["ИТОГО", "", data.docTracking.reduce((s, d) => s + d.qty, 0), data.docTracking.reduce((s, d) => s + d.usd, 0)]);
    totalRow.font = { bold: true };
  }
  ws6.columns.forEach((c) => (c.width = 28));

  const ws7 = wb.addWorksheet(`Ожидания ${monthNameRu(data.forecastPeriod.month)}`, { views: [{ showGridLines: false }] });
  ws7.mergeCells("A1:E1");
  ws7.getCell("A1").value = `Ожидания по продажам на ${monthNameRu(data.forecastPeriod.month)} ${data.forecastPeriod.year}`;
  ws7.getCell("A1").font = titleFont;
  if (data.opportunities.length > 0) {
    ws7.getCell("A2").value = `Учтённые возможности рынка: ${data.opportunities.join(", ")}`;
    ws7.getCell("A2").font = { italic: true, color: { argb: "FF6B7280" } };
  }
  ws7.addRow([]);
  styleHeaderRow(ws7.addRow(["Препарат", "База, уп.", "Итого (прогноз), уп.", "Итого (прогноз), $", "План след. месяца, $"]));
  data.forecast.forEach((f) => {
    const row = ws7.addRow([f.product_name, Math.round(f.base_packs), Math.round(f.total_packs), Math.round(f.total_usd), Math.round(f.next_target_usd)]);
    row.eachCell((c) => (c.border = border));
  });
  const forecastTotalRow = ws7.addRow(["ИТОГО", "", "", Math.round(data.forecastTotalUsd), Math.round(data.forecastTargetUsd)]);
  forecastTotalRow.font = { bold: true };
  if (data.forecastTargetUsd > 0) {
    const achRow = ws7.addRow(["Прогнозное выполнение", "", "", "", data.forecastTotalUsd / data.forecastTargetUsd]);
    achRow.getCell(5).numFmt = "0.0%";
    achRow.font = { bold: true };
  }
  ws7.columns.forEach((c) => (c.width = 26));

  if (data.analytics) {
    const ws8 = wb.addWorksheet("Аналитика", { views: [{ showGridLines: false }] });
    ws8.mergeCells("A1:E1");
    ws8.getCell("A1").value = "Аналитика (ИИ-анализ)";
    ws8.getCell("A1").font = titleFont;
    ws8.getCell("A2").value = `Сформировано: ${new Date(data.analytics.generated_at).toLocaleString("ru-RU")}`;
    ws8.getCell("A2").font = { italic: true, color: { argb: "FF6B7280" } };
    let ar = 5;
    const textSection = (title, text) => {
      if (!text) return;
      ws8.getCell(`A${ar}`).value = title; ws8.getCell(`A${ar}`).font = { bold: true, size: 13, color: { argb: NAVY } };
      ar += 1;
      ws8.mergeCells(`A${ar}:E${ar}`);
      ws8.getCell(`A${ar}`).value = text; ws8.getCell(`A${ar}`).alignment = { wrapText: true, vertical: "top" };
      ws8.getRow(ar).height = Math.max(20, Math.ceil(text.length / 90) * 15);
      ar += 2;
    };
    textSection("Главный вывод", data.analytics.summary);
    textSection("Динамика месяц-к-месяцу", data.analytics.monthly_dynamics);
    textSection("Конверсия и увеличение потенциала", data.analytics.conversion_potential_analysis);
    textSection("Работа с трудными врачами (NAVI)", data.analytics.navi_analysis);
    if (data.analytics.risks?.length) textSection("Риски", data.analytics.risks.map((x) => `• ${x}`).join("\n"));
    if (data.analytics.short_term_recommendations?.length) textSection("Рекомендации: краткосрочно", data.analytics.short_term_recommendations.map((x) => `• ${x}`).join("\n"));
    if (data.analytics.long_term_recommendations?.length) textSection("Рекомендации: долгосрочно", data.analytics.long_term_recommendations.map((x) => `• ${x}`).join("\n"));
    ws8.columns = Array(5).fill({ width: 22 });
  }

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(reportExportFilename(data, "xlsx"))}"`);
  await wb.xlsx.write(res);
  res.end();
});

app.get("/api/reports/:id/export/pptx", auth, async (req, res) => {
  const rid = req.params.id;
  const report = await checkExportAccess(req, res, rid);
  if (!report) return;
  const data = await loadFullReport(rid);

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE", width: 13.33, height: 7.5 });
  pptx.layout = "WIDE";
  // Same palette as the website: MSN navy/red, light background, sans-serif
  const BG = "FFFFFF", INK = "1F2937", MUTED = "6B7280", NAVY = "3E4095", GOLD = "ED3237", GREEN = "16A34A", RED = "DC2626", PANEL = "F7F8FC", LINE = "E4E7F0", ACCENT = "ED3237";
  const MSN_LOGO = path.join(__dirname, "assets", "msn-logo.png");

  function chrome(s, title) {
    s.background = { color: BG };
    s.addImage({ path: MSN_LOGO, x: 11.7, y: 0.25, w: 1.2, h: 0.6, sizing: { type: "contain", w: 1.2, h: 0.6 } });
    s.addText(title, { x: 0.5, y: 0.3, fontSize: 22, bold: true, color: NAVY, fontFace: "Arial" });
    s.addShape(pptx.ShapeType.line, { x: 0.5, y: 0.9, w: 10.8, h: 0, line: { color: ACCENT, width: 2 } });
  }
  function achColor(pct) { if (pct === null || pct === undefined) return MUTED; return pct >= 0.9 ? GREEN : pct < 0.8 ? RED : ACCENT; }

  // ---- Slide 1: cover ----
  let s = pptx.addSlide();
  s.background = { color: BG };
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: PANEL } });
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.18, h: 7.5, fill: { color: ACCENT } });
  s.addImage({ path: MSN_LOGO, x: 0.9, y: 0.6, w: 2.4, h: 1.2, sizing: { type: "contain", w: 2.4, h: 1.2 } });
  s.addText("Бизнес-ревью медпредставителя", { x: 0.9, y: 2.6, w: 11.5, h: 1, fontSize: 34, bold: true, color: NAVY, fontFace: "Arial" });
  s.addText(`${data.mp.full_name}   ·   ${data.mp.territory || "—"}`, { x: 0.9, y: 3.5, w: 11.5, h: 0.6, fontSize: 18, color: ACCENT, bold: true, fontFace: "Arial" });
  s.addText(`РМ: ${data.rm_name}   ·   Период: ${data.report.period_month}/${data.report.period_year}`, { x: 0.9, y: 4.05, w: 11.5, h: 0.5, fontSize: 14, color: MUTED, fontFace: "Arial" });

  // ---- Slide 2: FSS summary table ----
  s = pptx.addSlide(); chrome(s, "FSS — план vs факт");
  s.addText(`Достижение: ${(data.achievement * 100).toFixed(1)}%`, { x: 0.5, y: 1.0, fontSize: 20, bold: true, color: achColor(data.achievement) });
  s.addText(`План: $${Math.round(data.targetUsd).toLocaleString()}   Факт: $${Math.round(data.actualUsd).toLocaleString()}   Бонус: ${Math.round(data.bonusUzs).toLocaleString()} UZS`, { x: 0.5, y: 1.5, fontSize: 14, color: INK });
  const fssRows = [[
    { text: "Препарат", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
    { text: "План, уп.", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
    { text: "Факт, уп.", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
    { text: "Дост.", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
  ]];
  data.fssItems.slice(0, 14).forEach((it) => {
    const pct = it.target_usd ? it.actual_usd / it.target_usd : null;
    const cellFill = pct === null ? PANEL : pct >= 0.9 ? "E8F5EE" : pct < 0.8 ? "FBEAE9" : "FEF6E7";
    fssRows.push([
      { text: it.product_name, options: { color: INK, fill: { color: cellFill } } },
      { text: String(it.target_qty), options: { color: MUTED, fill: { color: cellFill }, align: "right" } },
      { text: String(it.actual_qty), options: { color: INK, fill: { color: cellFill }, align: "right" } },
      { text: pct === null ? "—" : `${(pct * 100).toFixed(0)}%`, options: { color: achColor(pct), bold: true, fill: { color: cellFill }, align: "right" } },
    ]);
  });
  s.addTable(fssRows, { x: 0.5, y: 2.0, w: 8.5, fontSize: 10, border: { color: LINE, pt: 0.5 }, autoPage: false });
  s.addChart(pptx.ChartType.bar, [
    { name: "План", labels: data.fssItems.slice(0, 8).map((it) => it.product_name.split(" ").slice(0, 2).join(" ")), values: data.fssItems.slice(0, 8).map((it) => Math.round(it.target_usd)) },
    { name: "Факт", labels: data.fssItems.slice(0, 8).map((it) => it.product_name.split(" ").slice(0, 2).join(" ")), values: data.fssItems.slice(0, 8).map((it) => Math.round(it.actual_usd)) },
  ], { x: 9.2, y: 1.0, w: 3.6, h: 5.5, chartColors: [MUTED, GOLD], showLegend: true, legendPos: "b", showValAxisTitle: false, catAxisLabelFontSize: 7, dataLabelFontSize: 7 });

  // ---- Slide 3: FFE ----
  s = pptx.addSlide(); chrome(s, "FFE — Field Force Effectiveness");
  s.addText(`Общий score: ${(data.ffeScore * 100).toFixed(1)}%  (порог для бонуса — 85%)`, { x: 0.5, y: 1.0, fontSize: 16, bold: true, color: data.ffeScore >= 0.85 ? GREEN : RED });
  const ffeRows = [[
    { text: "Метрика", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
    { text: "База", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
    { text: "Утв.", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
    { text: "Достигнуто", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
    { text: "%", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
  ]];
  data.ffeItems.forEach((it) => {
    const cellFill = it.percent >= 0.9 ? "E8F5EE" : it.percent < 0.8 ? "FBEAE9" : "FEF6E7";
    ffeRows.push([
      { text: it.label, options: { color: INK, fill: { color: cellFill } } },
      { text: String(it.master_list_count), options: { color: MUTED, fill: { color: cellFill }, align: "right" } },
      { text: String(it.approved_count), options: { color: MUTED, fill: { color: cellFill }, align: "right" } },
      { text: String(it.achieved_count), options: { color: INK, fill: { color: cellFill }, align: "right" } },
      { text: `${(it.percent * 100).toFixed(0)}%`, options: { color: achColor(it.percent), bold: true, fill: { color: cellFill }, align: "right" } },
    ]);
  });
  s.addTable(ffeRows, { x: 0.5, y: 1.6, w: 6.1, fontSize: 10, border: { color: LINE, pt: 0.5 }, autoPage: false });
  s.addChart(pptx.ChartType.bar, [
    { name: "Достигнуто, %", labels: data.ffeItems.map((it) => it.label), values: data.ffeItems.map((it) => Math.round(it.percent * 100)) },
  ], {
    x: 6.9, y: 1.6, w: 5.9, h: 4.8,
    barDir: "bar", chartColors: data.ffeItems.map((it) => achColor(it.percent)),
    showLegend: false, showValue: true, dataLabelColor: INK, dataLabelFontSize: 9,
    catAxisLabelColor: MUTED, catAxisLabelFontSize: 9, valAxisLabelColor: MUTED, valAxisLabelFontSize: 9,
    valAxisMinVal: 0, valAxisMaxVal: 100,
  });

  // ---- Slide 4: results & comments (red/green), fixed layout so lines never overlap ----
  s = pptx.addSlide(); chrome(s, "Итоги: сильные и слабые бренды");
  const good = data.fssItems.filter((it) => it.target_usd && it.actual_usd / it.target_usd >= 0.9);
  const bad = data.fssItems.filter((it) => it.target_usd && it.actual_usd / it.target_usd < 0.8);
  s.addText("✓ Выполнено (≥90%)", { x: 0.5, y: 1.0, w: 5.9, fontSize: 14, bold: true, color: GREEN });
  const goodLines = good.length
    ? good.map((it) => ({ text: `${it.product_name} — ${((it.actual_usd / it.target_usd) * 100).toFixed(0)}%\n`, options: { fontSize: 10, color: INK, breakLine: true } }))
    : [{ text: "нет позиций", options: { fontSize: 10, color: MUTED } }];
  s.addText(goodLines, { x: 0.5, y: 1.45, w: 5.9, h: 5.4, valign: "top", lineSpacingMultiple: 1.3 });

  s.addText("✗ Не выполнено (<80%)", { x: 6.9, y: 1.0, w: 5.9, fontSize: 14, bold: true, color: RED });
  const badLines = bad.length
    ? bad.map((it) => ({ text: `${it.product_name} — ${((it.actual_usd / it.target_usd) * 100).toFixed(0)}%\n`, options: { fontSize: 10, color: INK, breakLine: true } }))
    : [{ text: "нет позиций", options: { fontSize: 10, color: MUTED } }];
  s.addText(badLines, { x: 6.9, y: 1.45, w: 5.9, h: 2.6, valign: "top", lineSpacingMultiple: 1.3 });

  const badComments = data.comments.filter((c) => c.section === "fss").map((c) => `«${c.comment_text}» — ${c.author_name}`);
  s.addText("Комментарии по причинам:", { x: 6.9, y: 4.3, w: 5.9, fontSize: 11, bold: true, color: INK });
  const commentLines = badComments.length
    ? badComments.map((c) => ({ text: c + "\n", options: { fontSize: 9, color: MUTED, breakLine: true } }))
    : [{ text: "комментариев пока нет", options: { fontSize: 9, color: MUTED } }];
  s.addText(commentLines, { x: 6.9, y: 4.7, w: 5.9, h: 2.2, valign: "top", lineSpacingMultiple: 1.25 });

  // ---- Slide 4b: Конверсия — план/факт текущего месяца ----
  if (data.conversionPlanVsActual.items.length > 0) {
    s = pptx.addSlide(); chrome(s, "Конверсия — итоги плана за этот месяц");
    const pvaRows = [[
      { text: "Препарат (SKU)", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
      { text: "План, уп.", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
      { text: "Факт, уп.", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
      { text: "План, $", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
      { text: "Факт, $", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
      { text: "Выполнение", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
    ]];
    data.conversionPlanVsActual.items.forEach((it) => pvaRows.push([
      { text: it.product_name, options: { color: INK } },
      { text: String(Math.round(it.plan_packs)), options: { color: MUTED, align: "right" } },
      { text: String(Math.round(it.fact_packs)), options: { color: INK, align: "right" } },
      { text: `$${Math.round(it.plan_usd).toLocaleString()}`, options: { color: MUTED, align: "right" } },
      { text: `$${Math.round(it.fact_usd).toLocaleString()}`, options: { color: INK, align: "right" } },
      { text: it.achievement != null ? `${(it.achievement * 100).toFixed(0)}%` : "—", options: { color: achColor(it.achievement), bold: true, align: "right" } },
    ]));
    pvaRows.push([
      { text: "ИТОГО", options: { bold: true, fill: { color: PANEL } } },
      { text: "", options: { fill: { color: PANEL } } }, { text: "", options: { fill: { color: PANEL } } },
      { text: `$${Math.round(data.conversionPlanVsActual.totalPlanUsd).toLocaleString()}`, options: { bold: true, align: "right", fill: { color: PANEL } } },
      { text: `$${Math.round(data.conversionPlanVsActual.totalFactUsd).toLocaleString()}`, options: { bold: true, align: "right", fill: { color: PANEL } } },
      { text: data.conversionPlanVsActual.achievement != null ? `${(data.conversionPlanVsActual.achievement * 100).toFixed(0)}%` : "—", options: { bold: true, color: achColor(data.conversionPlanVsActual.achievement), align: "right", fill: { color: PANEL } } },
    ]);
    s.addTable(pvaRows, { x: 0.5, y: 1.0, w: 12.3, fontSize: 11, border: { color: LINE, pt: 0.5 }, autoPage: false });
  }

  // ---- Slide 5: Конверсия — по отдельным SKU, упаковки + $ + итог ----
  if (data.conversionSkuBreakdown.rows.length > 0) {
    s = pptx.addSlide(); chrome(s, "План конверсии врачей — по SKU");
    const convSkuRows = [[
      { text: "Препарат (SKU)", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
      { text: "Доп. упаковок/мес", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
      { text: "Доп. бизнес, $/мес", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
    ]];
    data.conversionSkuBreakdown.rows.forEach((r) => convSkuRows.push([
      { text: r.product_name, options: { color: INK } },
      { text: `+${Math.round(r.packs).toLocaleString()}`, options: { color: GREEN, bold: true, align: "right" } },
      { text: `+$${Math.round(r.usd).toLocaleString()}`, options: { color: GOLD, bold: true, align: "right" } },
    ]));
    convSkuRows.push([
      { text: "ИТОГО за месяц", options: { bold: true, color: INK, fill: { color: PANEL } } },
      { text: `+${Math.round(data.conversionSkuBreakdown.totalPacks).toLocaleString()}`, options: { bold: true, color: GREEN, align: "right", fill: { color: PANEL } } },
      { text: `+$${Math.round(data.conversionSkuBreakdown.totalUsd).toLocaleString()}`, options: { bold: true, color: GOLD, align: "right", fill: { color: PANEL } } },
    ]);
    s.addTable(convSkuRows, { x: 0.5, y: 1.0, w: 8.5, fontSize: 11, border: { color: LINE, pt: 0.5 }, autoPage: false });
    s.addShape(pptx.ShapeType.rect, { x: 9.3, y: 1.5, w: 3.5, h: 1.6, fill: { color: PANEL }, line: { color: LINE } });
    s.addText("ДОПОЛНИТЕЛЬНЫЙ БИЗНЕС ЗА МЕСЯЦ", { x: 9.5, y: 1.65, w: 3.1, fontSize: 9, color: MUTED });
    s.addText(`$${Math.round(data.conversionSkuBreakdown.totalUsd).toLocaleString()}`, { x: 9.5, y: 2.0, fontSize: 22, bold: true, color: GOLD });
  }

  // ---- Slide 5b: Потенциал — план/факт текущего месяца ----
  if (data.potentialPlanVsActual.items.length > 0) {
    s = pptx.addSlide(); chrome(s, "Увеличение потенциала — итоги плана за этот месяц");
    const pvaRows2 = [[
      { text: "Препарат (SKU)", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
      { text: "План, уп.", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
      { text: "Факт, уп.", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
      { text: "План, $", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
      { text: "Факт, $", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
      { text: "Выполнение", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
    ]];
    data.potentialPlanVsActual.items.forEach((it) => pvaRows2.push([
      { text: it.product_name, options: { color: INK } },
      { text: String(Math.round(it.plan_packs)), options: { color: MUTED, align: "right" } },
      { text: String(Math.round(it.fact_packs)), options: { color: INK, align: "right" } },
      { text: `$${Math.round(it.plan_usd).toLocaleString()}`, options: { color: MUTED, align: "right" } },
      { text: `$${Math.round(it.fact_usd).toLocaleString()}`, options: { color: INK, align: "right" } },
      { text: it.achievement != null ? `${(it.achievement * 100).toFixed(0)}%` : "—", options: { color: achColor(it.achievement), bold: true, align: "right" } },
    ]));
    pvaRows2.push([
      { text: "ИТОГО", options: { bold: true, fill: { color: PANEL } } },
      { text: "", options: { fill: { color: PANEL } } }, { text: "", options: { fill: { color: PANEL } } },
      { text: `$${Math.round(data.potentialPlanVsActual.totalPlanUsd).toLocaleString()}`, options: { bold: true, align: "right", fill: { color: PANEL } } },
      { text: `$${Math.round(data.potentialPlanVsActual.totalFactUsd).toLocaleString()}`, options: { bold: true, align: "right", fill: { color: PANEL } } },
      { text: data.potentialPlanVsActual.achievement != null ? `${(data.potentialPlanVsActual.achievement * 100).toFixed(0)}%` : "—", options: { bold: true, color: achColor(data.potentialPlanVsActual.achievement), align: "right", fill: { color: PANEL } } },
    ]);
    s.addTable(pvaRows2, { x: 0.5, y: 1.0, w: 12.3, fontSize: 11, border: { color: LINE, pt: 0.5 }, autoPage: false });
  }

  // ---- Slide 6: Потенциал — по отдельным SKU, упаковки + $ + итог ----
  if (data.potentialSkuBreakdown.rows.length > 0) {
    s = pptx.addSlide(); chrome(s, "План увеличения потенциала — по SKU");
    const potSkuRows = [[
      { text: "Препарат (SKU)", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
      { text: "Доп. упаковок/мес", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
      { text: "Доп. бизнес, $/мес", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
    ]];
    data.potentialSkuBreakdown.rows.forEach((r) => potSkuRows.push([
      { text: r.product_name, options: { color: INK } },
      { text: `+${Math.round(r.packs).toLocaleString()}`, options: { color: "7C3AED", bold: true, align: "right" } },
      { text: `+$${Math.round(r.usd).toLocaleString()}`, options: { color: GOLD, bold: true, align: "right" } },
    ]));
    potSkuRows.push([
      { text: "ИТОГО за месяц", options: { bold: true, color: INK, fill: { color: PANEL } } },
      { text: `+${Math.round(data.potentialSkuBreakdown.totalPacks).toLocaleString()}`, options: { bold: true, color: "7C3AED", align: "right", fill: { color: PANEL } } },
      { text: `+$${Math.round(data.potentialSkuBreakdown.totalUsd).toLocaleString()}`, options: { bold: true, color: GOLD, align: "right", fill: { color: PANEL } } },
    ]);
    s.addTable(potSkuRows, { x: 0.5, y: 1.0, w: 8.5, fontSize: 11, border: { color: LINE, pt: 0.5 }, autoPage: false });
    s.addShape(pptx.ShapeType.rect, { x: 9.3, y: 1.5, w: 3.5, h: 1.6, fill: { color: PANEL }, line: { color: LINE } });
    s.addText("ДОПОЛНИТЕЛЬНЫЙ БИЗНЕС ЗА МЕСЯЦ", { x: 9.5, y: 1.65, w: 3.1, fontSize: 9, color: MUTED });
    s.addText(`$${Math.round(data.potentialSkuBreakdown.totalUsd).toLocaleString()}`, { x: 9.5, y: 2.0, fontSize: 22, bold: true, color: GOLD });
  }

  // ---- Slide 6b: Мероприятия и активности — план/факт ----
  if (data.activitiesSummary.length > 0) {
    s = pptx.addSlide(); chrome(s, "Мероприятия и активности — план/факт");
    const actRows = [[
      { text: "Тип", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
      { text: "Категория", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
      { text: "План", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
      { text: "Факт", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
      { text: "%", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
    ]];
    data.activitiesSummary.forEach((a) => {
      const pct = a.planned ? a.completed / a.planned : 0;
      actRows.push([
        { text: a.type_name, options: { color: INK } },
        { text: a.kind === "event" ? "Мероприятие" : "Активность", options: { color: MUTED } },
        { text: String(a.planned), options: { color: MUTED, align: "right" } },
        { text: String(a.completed), options: { color: INK, bold: true, align: "right" } },
        { text: `${(pct * 100).toFixed(0)}%`, options: { color: achColor(pct), bold: true, align: "right" } },
      ]);
    });
    s.addTable(actRows, { x: 0.5, y: 1.0, w: 12.3, fontSize: 11, border: { color: LINE, pt: 0.5 }, autoPage: false });
  }

  // ---- Slide 7: Bonus detail ----
  s = pptx.addSlide(); chrome(s, "Прогресс по бонусу");
  const qb = data.quarterBonus;
  s.addText(`Квартал: Q${qb.quarter} ${qb.year}`, { x: 0.5, y: 1.0, fontSize: 14, color: MUTED });
  s.addText(`Достижение за квартал: ${(qb.achievement * 100).toFixed(1)}%`, { x: 0.5, y: 1.4, fontSize: 18, bold: true, color: achColor(qb.achievement) });
  s.addText(`Тариф: ${qb.tier_label}`, { x: 0.5, y: 1.9, fontSize: 13, color: INK });
  const gapLines = [];
  if (qb.achievement < 0.9) {
    const needUsd = Math.round(qb.target_usd * 0.9 - qb.actual_usd);
    gapLines.push(`Не хватает ~$${needUsd.toLocaleString()} до порога 90% (минимум для начала бонуса)`);
  }
  if (!qb.ffe_gate_passed) gapLines.push(`FFE score ${(qb.ffe_score * 100).toFixed(1)}% — нужно ≥85% для допуска к выплате`);
  if (!qb.non_reimbursement_ok) gapLines.push(`Не подтверждено условие ≥50% non-reimbursement продуктов`);
  if (!qb.all_months_approved) gapLines.push(`Не все 3 месяца квартала ещё одобрены РМ`);
  s.addText(gapLines.length ? "Что нужно для получения бонуса:" : "Все условия для бонуса выполнены ✓", { x: 0.5, y: 2.5, fontSize: 13, bold: true, color: gapLines.length ? RED : GREEN });
  s.addText(gapLines.join("\n"), { x: 0.5, y: 2.9, w: 8, h: 2, fontSize: 11, color: INK, valign: "top" });
  s.addShape(pptx.ShapeType.rect, { x: 0.5, y: 5.1, w: 6, h: 1.3, fill: { color: PANEL }, line: { color: LINE } });
  s.addText("ИТОГОВЫЙ БОНУС ЗА КВАРТАЛ", { x: 0.7, y: 5.25, fontSize: 11, color: MUTED });
  s.addText(`${Math.round(qb.bonus_uzs).toLocaleString()} UZS`, { x: 0.7, y: 5.55, fontSize: 24, bold: true, color: qb.bonus_uzs > 0 ? GOLD : RED });

  // ---- Slide 8: DOC TRACKING — сгруппировано по мероприятиям ----
  if (data.docTrackingGrouped.length > 0) {
    s = pptx.addSlide(); chrome(s, "DOC TRACKING — врачи по мероприятиям");
    const docRows = [[
      { text: "Мероприятие / Врач", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
      { text: "Упаковок", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
      { text: "Вклад, $", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
    ]];
    data.docTrackingGrouped.forEach((grp) => {
      docRows.push([
        { text: grp.event_name, options: { bold: true, color: NAVY, fill: { color: PANEL } } },
        { text: String(Math.round(grp.qty)), options: { bold: true, color: INK, align: "right", fill: { color: PANEL } } },
        { text: `$${Math.round(grp.usd).toLocaleString()}`, options: { bold: true, color: GREEN, align: "right", fill: { color: PANEL } } },
      ]);
      grp.doctors.forEach((d) => docRows.push([
        { text: `    ${d.doctor_name}`, options: { color: INK } },
        { text: String(Math.round(d.qty)), options: { color: MUTED, align: "right" } },
        { text: `$${Math.round(d.usd).toLocaleString()}`, options: { color: MUTED, align: "right" } },
      ]));
    });
    s.addTable(docRows, { x: 0.5, y: 1.0, w: 12.3, fontSize: 10, border: { color: LINE, pt: 0.5 }, autoPage: false });
  }

  // ---- Slide 9: Ожидания по продажам на следующий месяц ----
  s = pptx.addSlide(); chrome(s, `Ожидания по продажам на ${monthNameRu(data.forecastPeriod.month)} ${data.forecastPeriod.year}`);
  if (data.opportunities.length > 0) {
    s.addText(`Учтённые возможности рынка: ${data.opportunities.join(", ")}`, { x: 0.5, y: 1.0, fontSize: 11, italic: true, color: MUTED });
  }
  const forecastRows = [[
    { text: "Препарат", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
    { text: "База, уп.", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
    { text: "Прогноз, уп.", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
    { text: "Прогноз, $", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
    { text: "План, $", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
  ]];
  data.forecast.forEach((f) => forecastRows.push([
    { text: f.product_name, options: { color: INK } },
    { text: String(Math.round(f.base_packs)), options: { color: MUTED, align: "right" } },
    { text: String(Math.round(f.total_packs)), options: { color: INK, bold: true, align: "right" } },
    { text: `$${Math.round(f.total_usd).toLocaleString()}`, options: { color: GOLD, bold: true, align: "right" } },
    { text: f.next_target_usd ? `$${Math.round(f.next_target_usd).toLocaleString()}` : "—", options: { color: MUTED, align: "right" } },
  ]));
  s.addTable(forecastRows, { x: 0.5, y: data.opportunities.length > 0 ? 1.4 : 1.0, w: 12.3, fontSize: 10, border: { color: LINE, pt: 0.5 }, autoPage: false });

  s.addShape(pptx.ShapeType.rect, { x: 0.5, y: 5.7, w: 5.5, h: 1.1, fill: { color: PANEL }, line: { color: LINE } });
  s.addText("ИТОГОВОЕ ОЖИДАНИЕ", { x: 0.7, y: 5.82, fontSize: 10, color: MUTED });
  s.addText(`$${Math.round(data.forecastTotalUsd).toLocaleString()}`, { x: 0.7, y: 6.05, fontSize: 20, bold: true, color: GOLD });
  if (data.forecastTargetUsd > 0) {
    const pct = (data.forecastTotalUsd / data.forecastTargetUsd) * 100;
    s.addShape(pptx.ShapeType.rect, { x: 6.3, y: 5.7, w: 5.5, h: 1.1, fill: { color: PANEL }, line: { color: LINE } });
    s.addText("ПРОГНОЗНОЕ ВЫПОЛНЕНИЕ", { x: 6.5, y: 5.82, fontSize: 10, color: MUTED });
    s.addText(`${pct.toFixed(1)}%`, { x: 6.5, y: 6.05, fontSize: 20, bold: true, color: pct >= 100 ? GREEN : RED });
  }

  // ---- Slide 10: Аналитика (ИИ-анализ), если МП уже открывал вкладку Аналитика ----
  if (data.analytics) {
    s = pptx.addSlide(); chrome(s, "Аналитика — главный вывод");
    s.addText(data.analytics.summary || "", { x: 0.5, y: 1.1, w: 12.3, h: 2.2, fontSize: 13, color: INK, valign: "top" });
    if (data.analytics.conversion_potential_analysis) {
      s.addText("Конверсия и увеличение потенциала", { x: 0.5, y: 3.5, fontSize: 13, bold: true, color: NAVY });
      s.addText(data.analytics.conversion_potential_analysis, { x: 0.5, y: 3.9, w: 12.3, h: 1.8, fontSize: 11, color: INK, valign: "top" });
    }
    if (data.analytics.short_term_recommendations?.length) {
      s = pptx.addSlide(); chrome(s, "Аналитика — рекомендации");
      const bullets = data.analytics.short_term_recommendations.map((it) => ({ text: it, options: { bullet: true, color: ACCENT, breakLine: true, fontSize: 12 } }));
      s.addText(bullets, { x: 0.5, y: 1.1, w: 12.3, h: 5.8, valign: "top" });
    }
  }

  const buffer = await pptx.write({ outputType: "nodebuffer" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(reportExportFilename(data, "pptx"))}"`);
  res.end(buffer);
});

/* ============================================================ */
app.get("/", (req, res) => res.send("FSS Review Platform API running"));

// final error handler — any thrown/rejected error in a route ends up here as JSON,
// instead of crashing the whole server process
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Внутренняя ошибка сервера. Проверьте DATABASE_URL и логи." });
});

process.on("unhandledRejection", (err) => console.error("Unhandled rejection:", err));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`FSS Review server running on port ${PORT}`);
  console.log(`AI (NAVI/Аналитика): ${aiEnabled ? "включен, модель " + AI_MODEL : "ВЫКЛЮЧЕН — переменная ANTHROPIC_API_KEY не обнаружена"}`);
  if (!aiEnabled) {
    const related = Object.keys(process.env).filter((k) => /anthropic|api_key|claude/i.test(k));
    console.log(`Диагностика: переменные окружения, похожие на ANTHROPIC_API_KEY, которые видит сервер: ${related.length ? JSON.stringify(related) : "ни одной — сервер вообще не получает такую переменную"}`);
  }
});
