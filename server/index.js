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
const { aiEnabled, AI_MODEL, buildAnalyticsContext, callClaude } = require("./ai.js");

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
function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = (header.startsWith("Bearer ") ? header.slice(7) : null) || req.query.token || null;
  if (!token) return res.status(401).json({ error: "No token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
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
    { id: user.id, role: user.role, full_name: user.full_name, email: user.email, group_id: user.group_id },
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
  if (req.user.role === "master") {
    const { rows } = await pool.query(
      `select u.id, u.email, u.full_name, u.role, u.territory, u.rm_id, u.group_id, u.is_active, rm.full_name as rm_name, g.name as group_name
       from users u left join users rm on rm.id = u.rm_id left join groups g on g.id = u.group_id
       order by u.role, u.full_name`
    );
    return res.json(rows);
  }
  if (req.user.role === "rm") {
    const { rows } = await pool.query(
      `select u.id, u.email, u.full_name, u.role, u.territory, u.group_id, u.is_active, g.name as group_name
       from users u left join groups g on g.id = u.group_id where u.rm_id = $1 order by u.full_name`,
      [req.user.id]
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
  if (role === "mp" && !TERRITORIES.some((t) => t.label === territory)) {
    return res.status(400).json({ error: "Выберите территорию из списка" });
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

app.delete("/api/users/:id", auth, requireRole("master"), async (req, res) => {
  const { id } = req.params;
  if (String(id) === String(req.user.id)) return res.status(400).json({ error: "Нельзя удалить собственный аккаунт" });
  const check = await pool.query("select role from users where id=$1", [id]);
  if (!check.rows[0]) return res.status(404).json({ error: "Пользователь не найден" });
  await pool.query("update users set is_active=false where id=$1", [id]);
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
  res.json(TERRITORIES.map((t) => ({ key: t.key, label: t.label })));
});

/* ============================================================
   GROUPS — brand/portfolio groups (Rhythm, Prime, ...). Used to tag
   MP/BM accounts and products so BM oversight & Portfolio stay scoped.
   ============================================================ */
app.get("/api/groups", auth, async (req, res) => {
  const { rows } = await pool.query("select * from groups order by name");
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

/* ============================================================
   PORTFOLIO — product cards: PIL, visual-aid slides, key messages,
   positioning, patient portraits, competitors (manual prices).
   Visibility scoped by group; BM (own group) and Master can edit.
   ============================================================ */
const CONFIDENTIALITY_NOTICE =
  "Информация, представленная в этом материале, является абсолютно конфиденциальной и не должна быть " +
  "использована, продемонстрирована в любых случаях и ситуациях, кроме как внутри компании MSN Laboratories.";

async function portfolioScope(user) {
  if (user.role === "master") return { where: "1=1", values: [] };
  if (user.role === "mp" || user.role === "bm") return { where: "p.group_id = $1", values: [user.group_id] };
  if (user.role === "rm") {
    return {
      where: `p.group_id in (select distinct group_id from users where rm_id = $1 and group_id is not null)`,
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
    `select p.id, p.name, p.nrv_usd, p.group_id, g.name as group_name,
            (select count(*) from product_files f where f.product_id=p.id and f.file_type='pil') as pil_count,
            (select count(*) from product_files f where f.product_id=p.id and f.file_type='slides') as slides_count
     from products p left join groups g on g.id=p.group_id
     where p.is_active=true and ${scope.where} order by p.sort_order, p.name`,
    scope.values
  );
  res.json(rows);
});

app.post("/api/portfolio", auth, requireRole("master", "bm"), async (req, res) => {
  const { name, nrv_usd, group_id } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Укажите название препарата" });
  const gid = req.user.role === "bm" ? req.user.group_id : group_id;
  if (!gid) return res.status(400).json({ error: "Укажите группу" });
  const { rows } = await pool.query(
    "insert into products (name, nrv_usd, group_id, sort_order) values ($1,$2,$3,999) returning *",
    [name.trim(), nrv_usd || 0, gid]
  );
  res.json(rows[0]);
});

app.get("/api/portfolio/:id", auth, async (req, res) => {
  const { id } = req.params;
  const scope = await portfolioScope(req.user);
  const pRes = await pool.query(
    `select p.*, g.name as group_name from products p left join groups g on g.id=p.group_id where p.id=$1 and p.is_active=true and (${scope.where})`,
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
  const { name, key_messages, positioning, patient_portraits, nrv_usd, group_id } = req.body;
  // only master may move a product to a different group
  const newGroupId = req.user.role === "master" ? group_id : undefined;
  await pool.query(
    `update products set name=coalesce($1,name), key_messages=coalesce($2,key_messages), positioning=coalesce($3,positioning),
     patient_portraits=coalesce($4,patient_portraits), nrv_usd=coalesce($5,nrv_usd), group_id=coalesce($6,group_id), updated_at=now() where id=$7`,
    [name, key_messages, positioning, patient_portraits, nrv_usd, newGroupId, id]
  );
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
  const scope = await portfolioScope(req.user);
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
  const scope = await portfolioScope(req.user);
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
  const scope = await portfolioScope(req.user);
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
  const scope = await portfolioScope(req.user);
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
  const scope = await portfolioScope(req.user);
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
  const logRes = await pool.query(
    "insert into import_log (import_type, period_year, period_month, uploaded_by, summary, changes) values ('fss',$1,$2,$3,$4,$5) returning id",
    [year, month, req.user.id, summary, JSON.stringify(changes)]
  );
  res.json({ ...summary, import_id: logRes.rows[0].id });
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
  const logRes = await pool.query(
    "insert into import_log (import_type, period_year, uploaded_by, summary, changes) values ('targets',$1,$2,$3,$4) returning id",
    [1999 + Number(fy), req.user.id, summary, JSON.stringify(changes)]
  );
  res.json({ ...summary, import_id: logRes.rows[0].id });
});

/* ---- Import history: list + undo ---- */
app.get("/api/import/history", auth, requireRole("master"), async (req, res) => {
  const { rows } = await pool.query(
    `select l.id, l.import_type, l.period_year, l.period_month, l.summary, l.reverted, l.created_at, u.full_name as uploaded_by_name
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
  const changes = log.changes || [];
  for (const c of changes) {
    await pool.query(`update report_fss set ${c.field}=$1 where report_id=$2 and product_id=$3`, [c.old_value || 0, c.report_id, c.product_id]);
  }
  await pool.query("update import_log set reverted=true where id=$1", [id]);
  res.json({ ok: true, reverted_cells: changes.length });
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
    conversion: { items: convRes.rows, summary: buildBrandSummary(convRes.rows, "current_rx_per_week") },
    potential: { items: potRes.rows, summary: buildBrandSummary(potRes.rows, "current_potential_per_week") },
    comments: commentsRes.rows,
    status_log: logRes.rows,
  });
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
  // returns { where: sql fragment referencing "mp", values: [] } to inject into a query joining tracked_doctors td + users mp on mp.id=td.mp_id
  if (user.role === "master") return { where: "1=1", values: [] };
  if (user.role === "mp") return { where: "td.mp_id = $1", values: [user.id] };
  if (user.role === "rm") return { where: "mp.rm_id = $1", values: [user.id] };
  if (user.role === "bm") return { where: "mp.group_id = $1", values: [user.group_id] };
  return { where: "1=0", values: [] };
}

async function canAccessDoctor(user, doctorId) {
  const r = await pool.query(
    `select td.mp_id, mp.rm_id, mp.group_id from tracked_doctors td join users mp on mp.id=td.mp_id where td.id=$1`,
    [doctorId]
  );
  const row = r.rows[0];
  if (!row) return false;
  if (user.role === "master") return true;
  if (user.role === "mp") return row.mp_id === user.id;
  if (user.role === "rm") return row.rm_id === user.id;
  if (user.role === "bm") return row.group_id === user.group_id;
  return false;
}

app.get("/api/doc-tracking/doctors", auth, async (req, res) => {
  const scope = await docTrackingScope(req.user);
  const { rows } = await pool.query(
    `select td.*, mp.full_name as mp_name, mp.territory as mp_territory
     from tracked_doctors td join users mp on mp.id=td.mp_id
     where ${scope.where} order by td.created_at desc`,
    scope.values
  );
  res.json(rows);
});

app.post("/api/doc-tracking/doctors", auth, requireRole("mp"), async (req, res) => {
  const { full_name, specialty, city, clinic, contact, trip_start, trip_end, event_name, event_city, pharmacies } = req.body;
  if (!full_name || !full_name.trim()) return res.status(400).json({ error: "Укажите ФИО врача" });
  const { rows } = await pool.query(
    `insert into tracked_doctors (mp_id, full_name, specialty, city, clinic, contact, trip_start, trip_end, event_name, event_city)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
    [req.user.id, full_name, specialty || null, city || null, clinic || null, contact || null, trip_start || null, trip_end || null, event_name || null, event_city || null]
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
    `select td.*, mp.full_name as mp_name from tracked_doctors td join users mp on mp.id=td.mp_id where td.id=$1`, [id]
  );
  const pharmRes = await pool.query("select * from doctor_pharmacies where doctor_id=$1 order by sort_order", [id]);
  const logRes = await pool.query(
    `select l.*, p.name as product_name, p.nrv_usd, ph.name as pharmacy_name
     from doctor_weekly_log l join products p on p.id=l.product_id left join doctor_pharmacies ph on ph.id=l.pharmacy_id
     where l.doctor_id=$1 order by l.log_date desc`, [id]
  );
  const logWithUsd = logRes.rows.map((r) => ({ ...r, usd: Number(r.qty_packages) * Number(r.nrv_usd) }));

  const monthly = {};
  for (const r of logWithUsd) {
    const d = new Date(r.log_date);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    monthly[key] ||= { year: d.getFullYear(), month: d.getMonth() + 1, qty: 0, usd: 0 };
    monthly[key].qty += Number(r.qty_packages);
    monthly[key].usd += r.usd;
  }
  const monthlySummary = Object.values(monthly).sort((a, b) => (a.year - b.year) || (a.month - b.month));

  res.json({ doctor: docRes.rows[0], pharmacies: pharmRes.rows, log: logWithUsd, monthly: monthlySummary, total_usd: logWithUsd.reduce((s, r) => s + r.usd, 0) });
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
  return false;
}

app.get("/api/mp-profile/:mpId", auth, requireRole("rm", "master"), async (req, res) => {
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

  res.json({
    mp: mpRes.rows[0], history, comments: commentsRes.rows,
    monthly: salesTrend?.months || [], quarterly: salesTrend?.quarterly || [], yearly: salesTrend?.yearly || [],
    bonus, plans: plansRes.rows,
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
    [mpId, req.user.id, period_year, period_month, strengths || "", weaknesses || "", JSON.stringify(kpis || []), JSON.stringify(achieved_kpis || []), rm_comment || ""]
  );
  res.json({ ok: true });
});

/* ============================================================
   DASHBOARD — visual org-wide (master) or team (rm) summary
   ============================================================ */
app.get("/api/dashboard", auth, requireRole("master", "rm"), async (req, res) => {
  const rmFilter = req.user.role === "rm" ? "and rm.id = $1" : "";
  const params = req.user.role === "rm" ? [req.user.id] : [];

  const rmsRes = await pool.query(
    `select rm.id, rm.full_name, rm.territory from users rm where rm.role='rm' and rm.is_active=true ${rmFilter} order by rm.full_name`,
    params
  );

  const hierarchy = [];
  let companyTarget = 0, companyActual = 0, companyBonusUzs = 0;

  for (const rm of rmsRes.rows) {
    const mpsRes = await pool.query("select id, full_name, territory from users where rm_id=$1 and role='mp' and is_active=true order by full_name", [rm.id]);
    let rmTarget = 0, rmActual = 0;
    const mpNodes = [];
    for (const mp of mpsRes.rows) {
      const latestRes = await pool.query(
        "select id, period_year, period_month from reports where mp_id=$1 and status='approved' order by period_year desc, period_month desc limit 1",
        [mp.id]
      );
      const latest = latestRes.rows[0];
      let target_usd = 0, actual_usd = 0, achievement = null, bonus_uzs = 0;
      if (latest) {
        const fssRes = await pool.query(
          `select f.target_qty, f.actual_qty, p.nrv_usd from report_fss f join products p on p.id=f.product_id where f.report_id=$1`, [latest.id]
        );
        for (const row of fssRes.rows) {
          target_usd += Number(row.target_qty) * Number(row.nrv_usd);
          actual_usd += Number(row.actual_qty) * Number(row.nrv_usd);
        }
        achievement = target_usd ? actual_usd / target_usd : null;
        const quarter = quarterOf(latest.period_month);
        const qb = await computeMpQuarterBonus(mp.id, latest.period_year, quarter);
        bonus_uzs = qb.bonus_uzs;
      }
      rmTarget += target_usd; rmActual += actual_usd;
      mpNodes.push({
        id: mp.id, name: mp.full_name, territory: mp.territory,
        latest_period: latest ? `${latest.period_month}/${latest.period_year}` : null,
        target_usd: Math.round(target_usd), actual_usd: Math.round(actual_usd), achievement, bonus_uzs: Math.round(bonus_uzs),
      });
    }
    companyTarget += rmTarget; companyActual += rmActual;
    companyBonusUzs += mpNodes.reduce((s, m) => s + m.bonus_uzs, 0);
    hierarchy.push({
      id: rm.id, name: rm.full_name, territory: rm.territory,
      target_usd: Math.round(rmTarget), actual_usd: Math.round(rmActual),
      achievement: rmTarget ? rmActual / rmTarget : null,
      mps: mpNodes,
    });
  }

  res.json({
    hierarchy,
    company: { target_usd: Math.round(companyTarget), actual_usd: Math.round(companyActual), achievement: companyTarget ? companyActual / companyTarget : null, bonus_uzs: Math.round(companyBonusUzs) },
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

app.get("/api/ai-insights", auth, async (req, res) => {
  if (!aiEnabled) return res.status(503).json({ error: "ИИ-анализ не настроен на сервере (нет ANTHROPIC_API_KEY)" });
  const refresh = req.query.refresh === "true";
  let scope, scopeId, mpIds, label;

  if (req.user.role === "mp") {
    scope = "mp"; scopeId = req.user.id; mpIds = [req.user.id];
    const u = await pool.query("select full_name from users where id=$1", [req.user.id]);
    label = `МП ${u.rows[0]?.full_name || ""}`;
  } else if (req.user.role === "rm") {
    scope = "rm"; scopeId = req.user.id;
    const team = await pool.query("select id from users where rm_id=$1 and role='mp'", [req.user.id]);
    mpIds = team.rows.map((r) => r.id);
    label = "Команда РМ";
  } else if (req.user.role === "master") {
    scope = "master"; scopeId = null;
    const all = await pool.query("select id from users where role='mp'");
    mpIds = all.rows.map((r) => r.id);
    label = "Вся компания";
  } else {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (!refresh) {
    const cacheRes = await pool.query(
      `select * from ai_insights where scope=$1 and scope_id ${scopeId === null ? "is null" : "=$2"} order by created_at desc limit 1`,
      scopeId === null ? [scope] : [scope, scopeId]
    );
    const cached = cacheRes.rows[0];
    if (cached && (Date.now() - new Date(cached.created_at).getTime()) < AI_CACHE_HOURS * 3600 * 1000) {
      return res.json({ ...cached.content, generated_at: cached.created_at, cached: true });
    }
  }

  const context = await buildAnalyticsContext(pool, { mpIds, label });
  if (!context || context.months.length === 0) {
    return res.json({ summary: "Недостаточно данных для анализа — нет ни одного одобренного отчёта.", monthly_dynamics: "", quarterly_dynamics: "", yearly_dynamics: "", risks: [], short_term_recommendations: [], long_term_recommendations: [], generated_at: new Date(), cached: false });
  }

  let content;
  try {
    content = await callClaude(context);
  } catch (e) {
    console.error("AI insights error:", e.message);
    return res.status(502).json({ error: "Не удалось получить анализ от ИИ. Попробуйте позже." });
  }

  await pool.query(
    "insert into ai_insights (scope, scope_id, content, model) values ($1,$2,$3,$4)",
    [scope, scopeId, content, AI_MODEL]
  );
  res.json({ ...content, generated_at: new Date(), cached: false });
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
    `select c.*, p.name as product_name from report_conversion c join products p on p.id=c.product_id where c.report_id=$1`, [rid]);
  const potRes = await pool.query(
    `select c.*, p.name as product_name from report_potential c join products p on p.id=c.product_id where c.report_id=$1`, [rid]);
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

  return {
    report, mp: mpRes.rows[0], rm_name: rmRes.rows[0]?.full_name || "—",
    fssItems, targetUsd, actualUsd, achievement, rawBonusUzs, bonusUzs, bonusUsd: bonusUzs / Number(report.fx_rate),
    ffeItems, ffeScore, ffeGatePassed, actionPlan: apRes.rows, conversion: convRes.rows, potential: potRes.rows,
    comments: commentsRes.rows, quarterBonus, docTracking,
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

  const NAVY = "FF1F2937", GOLD = "FFE8B04B", GREEN = "FFC6EFCE", GREENFONT = "FF1B5E20", RED = "FFFDE0DF", REDFONT = "FFB71C1C", LIGHT = "FFF7F8FA";
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

  const ws1 = wb.addWorksheet("FSS", { views: [{ showGridLines: false }] });
  ws1.mergeCells("A1:G1");
  ws1.getCell("A1").value = `Отчёт FSS — ${data.mp.full_name}`;
  ws1.getCell("A1").font = titleFont;
  ws1.getCell("A2").value = `Территория: ${data.mp.territory || "—"}   ·   РМ: ${data.rm_name}   ·   Период: ${data.report.period_month}/${data.report.period_year}`;
  ws1.getCell("A2").font = { italic: true, color: { argb: "FF6B7280" } };
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

  const ws5 = wb.addWorksheet("Увеличение потенциала", { views: [{ showGridLines: false }] });
  styleHeaderRow(ws5.addRow(["Препарат", "Врач", "Специальность", "ЛПУ", "Текущий потенциал, Rx/нед", "Причина", "План МП", "Цель, Rx/нед", "Начало", "Контроль"]));
  data.potential.forEach((it) => {
    const row = ws5.addRow([it.product_name, it.doctor_name, it.doctor_specialty, it.lpu_name, Number(it.current_potential_per_week), it.reason_not_treating, it.mp_action_plan, Number(it.target_rx_per_week), it.start_date, it.control_date]);
    row.eachCell((c) => (c.border = border));
  });
  ws5.columns.forEach((c) => (c.width = 22));

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

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="report_${rid}.xlsx"`);
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
  // Light, clean theme
  const BG = "FFFFFF", INK = "1F2937", MUTED = "6B7280", GOLD = "C58A1F", GREEN = "1B8A5A", RED = "C0392B", PANEL = "F3F4F6", LINE = "E5E7EB";

  function chrome(s, title) {
    s.background = { color: BG };
    s.addText(title, { x: 0.5, y: 0.3, fontSize: 22, bold: true, color: INK, fontFace: "Georgia" });
    s.addShape(pptx.ShapeType.line, { x: 0.5, y: 0.85, w: 12.3, h: 0, line: { color: GOLD, width: 2 } });
  }
  function achColor(pct) { if (pct === null || pct === undefined) return MUTED; return pct >= 0.9 ? GREEN : pct < 0.8 ? RED : GOLD; }

  // ---- Slide 1: cover ----
  let s = pptx.addSlide();
  s.background = { color: BG };
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: PANEL } });
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.18, h: 7.5, fill: { color: GOLD } });
  s.addText("Бизнес-ревью медпредставителя", { x: 0.9, y: 2.6, w: 11.5, h: 1, fontSize: 34, bold: true, color: INK, fontFace: "Georgia" });
  s.addText(`${data.mp.full_name}   ·   ${data.mp.territory || "—"}`, { x: 0.9, y: 3.5, w: 11.5, h: 0.6, fontSize: 18, color: GOLD, bold: true });
  s.addText(`РМ: ${data.rm_name}   ·   Период: ${data.report.period_month}/${data.report.period_year}`, { x: 0.9, y: 4.05, w: 11.5, h: 0.5, fontSize: 14, color: MUTED });

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
  s.addTable(ffeRows, { x: 0.5, y: 1.6, w: 12.3, fontSize: 11, border: { color: LINE, pt: 0.5 }, autoPage: false });

  // ---- Slide 4: results & comments (red/green) ----
  s = pptx.addSlide(); chrome(s, "Итоги: сильные и слабые бренды");
  const good = data.fssItems.filter((it) => it.target_usd && it.actual_usd / it.target_usd >= 0.9);
  const bad = data.fssItems.filter((it) => it.target_usd && it.actual_usd / it.target_usd < 0.8);
  s.addText("✓ Выполнено (≥90%)", { x: 0.5, y: 1.0, fontSize: 14, bold: true, color: GREEN });
  s.addText(good.length ? good.map((it) => `${it.product_name} — ${((it.actual_usd / it.target_usd) * 100).toFixed(0)}%`).join("\n") : "нет позиций", { x: 0.5, y: 1.4, w: 5.8, h: 4.8, fontSize: 10, color: INK, valign: "top" });
  s.addText("✗ Не выполнено (<80%)", { x: 6.7, y: 1.0, fontSize: 14, bold: true, color: RED });
  s.addText(bad.length ? bad.map((it) => `${it.product_name} — ${((it.actual_usd / it.target_usd) * 100).toFixed(0)}%`).join("\n") : "нет позиций", { x: 6.7, y: 1.4, w: 5.8, h: 2.2, fontSize: 10, color: INK, valign: "top" });
  const badComments = data.comments.filter((c) => c.section === "fss").map((c) => `«${c.comment_text}» — ${c.author_name}`);
  s.addText("Комментарии по причинам:", { x: 6.7, y: 3.7, fontSize: 11, bold: true, color: INK });
  s.addText(badComments.length ? badComments.join("\n") : "комментариев пока нет", { x: 6.7, y: 4.1, w: 5.8, h: 2.5, fontSize: 9, color: MUTED, valign: "top" });

  // ---- Slide 5: Конверсия ----
  if (data.conversion.length > 0) {
    s = pptx.addSlide(); chrome(s, "План конверсии врачей");
    const convRows = [[
      { text: "Препарат", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
      { text: "Врач", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
      { text: "Наш преп.", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
      { text: "Конкур.", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
      { text: "Цель", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
    ]];
    data.conversion.slice(0, 16).forEach((it) => convRows.push([
      { text: it.product_name, options: { color: INK } }, { text: it.doctor_name, options: { color: INK } },
      { text: String(it.current_rx_per_week), options: { color: MUTED, align: "right" } },
      { text: String(it.competitor_rx_per_week), options: { color: RED, align: "right" } },
      { text: String(it.target_rx_per_week), options: { color: GREEN, bold: true, align: "right" } },
    ]));
    s.addTable(convRows, { x: 0.5, y: 1.0, w: 12.3, fontSize: 10, border: { color: LINE, pt: 0.5 }, autoPage: false });
  }

  // ---- Slide 6: Потенциал ----
  if (data.potential.length > 0) {
    s = pptx.addSlide(); chrome(s, "План увеличения потенциала");
    const potRows = [[
      { text: "Препарат", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
      { text: "Врач", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
      { text: "Текущий потенциал", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
      { text: "Цель", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
    ]];
    data.potential.slice(0, 16).forEach((it) => potRows.push([
      { text: it.product_name, options: { color: INK } }, { text: it.doctor_name, options: { color: INK } },
      { text: String(it.current_potential_per_week), options: { color: MUTED, align: "right" } },
      { text: String(it.target_rx_per_week), options: { color: GREEN, bold: true, align: "right" } },
    ]));
    s.addTable(potRows, { x: 0.5, y: 1.0, w: 12.3, fontSize: 10, border: { color: LINE, pt: 0.5 }, autoPage: false });
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

  // ---- Slide 8: DOC TRACKING ----
  if (data.docTracking.length > 0) {
    s = pptx.addSlide(); chrome(s, "DOC TRACKING — врачи после конференций");
    const docRows = [[
      { text: "Врач", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
      { text: "Мероприятие", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
      { text: "Упаковок", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
      { text: "Вклад, $", options: { bold: true, fill: { color: INK }, color: "FFFFFF" } },
    ]];
    data.docTracking.forEach((it) => docRows.push([
      { text: it.doctor_name, options: { color: INK } }, { text: it.event_name || "—", options: { color: MUTED } },
      { text: String(Math.round(it.qty)), options: { color: INK, align: "right" } },
      { text: `$${Math.round(it.usd).toLocaleString()}`, options: { color: GREEN, bold: true, align: "right" } },
    ]));
    s.addTable(docRows, { x: 0.5, y: 1.0, w: 12.3, fontSize: 11, border: { color: LINE, pt: 0.5 }, autoPage: false });
  }

  const buffer = await pptx.write({ outputType: "nodebuffer" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
  res.setHeader("Content-Disposition", `attachment; filename="report_${rid}.pptx"`);
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
app.listen(PORT, () => console.log(`FSS Review server running on port ${PORT}`));
