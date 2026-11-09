// MESTO — локальный запуск без Docker: встроенный PostgreSQL + API + кабинет владельца (и приложение кассира).
// Данные хранятся в папке data/ рядом с программой. Остановка — Ctrl+C или закрытие окна.
// Нужен только Node.js 22+. Первый запуск скачивает зависимости (нужен интернет, 1–3 минуты).
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, request } from "node:http";
import net from "node:net";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API_DIR = join(ROOT, "app", "api");
const LOCAL_DIR = join(ROOT, "local");
const WEB = { owner: join(ROOT, "app", "web", "owner"), cashier: join(ROOT, "app", "web", "cashier") };
const DATA = join(ROOT, "data");
const isWin = process.platform === "win32";

let stopping = false;
let pg = null;
let pgOwned = false;
let api = null;
let servers = [];
async function shutdown(exit = true) {
  if (stopping) return;
  stopping = true;
  try { api?.kill(); } catch {}
  for (const s of servers) try { s.close(); } catch {}
  try { if (pgOwned) await pg.stop(); } catch {}
  if (exit) process.exit(0);
}

const say = (m = "") => console.log(m);
let gracefulExit = null; // из пакета exit-hook (подгружается вместе с базой): завершает без предупреждений о «синхронном выходе»
const fail = (m) => {
  console.error(`\n[X] ${m}\n`);
  if (gracefulExit) {
    gracefulExit(1);
    return new Promise(() => {}); // выход асинхронный: останавливаем дальнейшее выполнение, пока процесс не завершится
  }
  process.exit(1);
};

if (Number(process.versions.node.split(".")[0]) < 22) fail(`Нужен Node.js 22 или новее, а установлен ${process.versions.node}. Скачайте LTS с https://nodejs.org`);
for (const p of [join(API_DIR, "main.js"), WEB.owner, WEB.cashier]) if (!existsSync(p)) fail(`Не найден ${p}. Распакуйте архив целиком.`);

say("\n  MESTO — локальный запуск");
say("  ------------------------");

// ---------- 1. зависимости (один раз) ----------
function install(dir, label, args) {
  const stamp = join(dir, "node_modules", ".mesto-installed");
  if (existsSync(stamp)) return;
  say(`Устанавливаю ${label} (один раз, нужен интернет)...`);
  const cmd = ["npm", "install", ...args, "--no-audit", "--no-fund", "--loglevel=error"].join(" ");
  const r = spawnSync(cmd, { cwd: dir, stdio: "inherit", shell: true });
  if (r.status !== 0) fail(`Не удалось установить ${label}. Проверьте интернет и повторите запуск.`);
  writeFileSync(stamp, new Date().toISOString());
}
// PostgreSQL на Windows не работает, если в пути есть не латинские символы (кириллица в имени папки или пользователя):
// initdb падает с «invalid byte sequence for encoding UTF8». Тогда движок и данные базы лежат в латинской папке.
const nonAscii = (p) => /[^\x00-\x7F]/.test(p);
let ENGINE_DIR = LOCAL_DIR;
let PG_BASE = DATA;
if (isWin && (nonAscii(LOCAL_DIR) || nonAscii(DATA))) {
  const base = process.env.PUBLIC && !nonAscii(process.env.PUBLIC) ? process.env.PUBLIC : "C:\\Users\\Public";
  const id = createHash("sha256").update(ROOT).digest("hex").slice(0, 8);
  ENGINE_DIR = join(base, "MESTO", id);
  PG_BASE = ENGINE_DIR;
  mkdirSync(ENGINE_DIR, { recursive: true });
  copyFileSync(join(LOCAL_DIR, "package.json"), join(ENGINE_DIR, "package.json"));
  say(`В пути к программе есть не латинские символы. PostgreSQL с ними не работает, поэтому база данных будет храниться здесь:\n  ${ENGINE_DIR}`);
}

install(API_DIR, "компоненты сервера", ["--omit=dev"]);
install(ENGINE_DIR, "встроенную базу данных", []);

// ---------- 2. секреты и порты ----------
mkdirSync(DATA, { recursive: true });
const cfgFile = join(DATA, "local.json");
let cfg = existsSync(cfgFile) ? JSON.parse(readFileSync(cfgFile, "utf8")) : {};
if (!cfg.jwtSecret || !cfg.pgPassword) {
  cfg = { jwtSecret: randomBytes(48).toString("hex"), pgPassword: randomBytes(18).toString("hex") };
  writeFileSync(cfgFile, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

const isFree = (port) =>
  new Promise((res) => {
    const s = net.createServer();
    s.once("error", () => res(false));
    s.listen(port, "127.0.0.1", () => s.close(() => res(true)));
  });
async function freePort(start, skip = []) {
  for (let p = start; p < start + 200; p++) if (!skip.includes(p) && (await isFree(p))) return p;
  fail(`Не нашёл свободный порт начиная с ${start}.`);
}
const ownerPort = await freePort(8080);
const cashierPort = await freePort(ownerPort + 1);
const apiPort = await freePort(38100);

// ---------- 3. PostgreSQL ----------
const pgDir = join(PG_BASE, "pg");
const pidFile = join(pgDir, "postmaster.pid");
// подготовка базы (initdb) записывает pg_control в самом конце: если его нет, прошлая подготовка оборвалась, данных там нет
const initialised = existsSync(join(pgDir, "PG_VERSION")) && existsSync(join(pgDir, "global", "pg_control"));
const fresh = !initialised;
if (fresh && existsSync(pgDir)) rmSync(pgDir, { recursive: true, force: true });
let pgPort = await freePort(54329);
const reachable = (port) =>
  new Promise((res) => {
    const s = net.connect(port, "127.0.0.1");
    s.once("connect", () => (s.destroy(), res(true)));
    s.once("error", () => res(false));
  });

// база осталась работать после аварийного закрытия окна — подключаемся к ней
let reuse = false;
if (!fresh && existsSync(pidFile)) {
  const port = Number(readFileSync(pidFile, "utf8").split("\n")[3]);
  if (port && (await reachable(port))) {
    pgPort = port;
    reuse = true;
    say("База данных уже запущена — подключаюсь к ней.");
  } else {
    // устаревший замок от аварийно завершённого процесса (на Windows номера процессов переиспользуются и сбивают проверку)
    try { rmSync(pidFile, { force: true }); } catch {}
  }
}

// вывод базы сохраняем: по нему видно настоящую причину, если она не запустилась
const logFile = join(DATA, "database.log");
const pgLog = [];
try { writeFileSync(logFile, ""); } catch {}
const keepLog = (m) => {
  const t = String(m ?? "").trim();
  if (!t) return;
  pgLog.push(t);
  if (pgLog.length > 300) pgLog.shift();
  try { appendFileSync(logFile, t + "\n"); } catch {}
};

function explainDbFailure(reason) {
  const text = pgLog.join("\n");
  const hints = [];
  if (/administrative permissions|cannot be run as root|run as root|права администратора/i.test(text + reason))
    hints.push("Запустите MESTO обычным двойным щелчком, НЕ «от имени администратора»: PostgreSQL отказывается работать с правами администратора.");
  if (/address already in use|could not bind|Only one usage of each socket/i.test(text))
    hints.push("Порт базы данных занят другой программой. Закройте другие окна MESTO и повторите запуск.");
  if (/lock file|postmaster\.pid|another server might be running/i.test(text))
    hints.push("База уже запущена другим окном MESTO. Закройте его (или перезагрузите компьютер) и повторите.");
  if (/permission denied|access is denied|отказано в доступе|could not (create|open) (file|directory)/i.test(text))
    hints.push("Нет доступа к папке с данными. Перенесите папку MESTO в обычное место, например C:\\MESTO или «Документы», и проверьте, что антивирус не блокирует postgres.exe.");
  if (/could not create shared memory|shmget|CreateFileMapping|out of memory|недостаточно памяти/i.test(text))
    hints.push("Не хватает оперативной памяти. Закройте лишние программы и повторите.");
  if (!text && isWin)
    hints.push("База завершилась сразу и ничего не написала. Частые причины: (1) не установлен «Microsoft Visual C++ Redistributable» — скачайте и установите https://aka.ms/vs/17/release/vc_redist.x64.exe, затем повторите; (2) антивирус заблокировал postgres.exe — добавьте папку MESTO в исключения.");
  if (nonAscii(ROOT))
    hints.push(`В пути к программе есть не латинские символы (${ROOT}). Если ошибка не исчезла, перенесите папку MESTO в путь только из латинских букв, например C:\\MESTO.`);
  return hints;
}

if (!reuse) {
  const modPath = join(ENGINE_DIR, "node_modules", "embedded-postgres", "dist", "index.js");
  if (!existsSync(modPath)) fail(`Не найдена встроенная база данных. Удалите папку ${join(ENGINE_DIR, "node_modules")} и запустите снова.`);
  try {
    ({ gracefulExit } = await import(pathToFileURL(join(ENGINE_DIR, "node_modules", "exit-hook", "index.js")).href));
  } catch {}
  const { default: EmbeddedPostgres } = await import(pathToFileURL(modPath).href);
  pg = new EmbeddedPostgres({
    databaseDir: pgDir,
    user: "mesto",
    password: cfg.pgPassword,
    port: pgPort,
    persistent: true,
    initdbFlags: ["--encoding=UTF8"],
    onLog: keepLog,
    onError: keepLog,
  });
  say(fresh ? "Готовлю базу данных (первый запуск)..." : "Запускаю базу данных...");
  try {
    if (fresh) await pg.initialise();
    await pg.start();
    // база создаётся отдельным шагом: если прошлый запуск оборвался между ними, она может отсутствовать
    try {
      await pg.createDatabase("mesto");
    } catch (e) {
      if (!/already exists|уже существует/i.test(String(e?.message ?? e))) throw e;
    }
    pgOwned = true;
  } catch (e) {
    const reason = e?.message || "процесс базы данных завершился сразу после запуска";
    const tail = pgLog.slice(-12).join("\n  ");
    const hints = explainDbFailure(reason);
    await fail(
      `База данных не запустилась: ${reason}` +
        (tail ? `\n\nЧто написала база:\n  ${tail}` : "") +
        (hints.length ? `\n\nЧто делать:\n - ${hints.join("\n - ")}` : "") +
        `\n\nПолный журнал: ${logFile}\nЕсли ничего не помогло и данных у вас ещё нет — удалите папку базы (${pgDir}) и запустите снова.`,
    );
  }
}
const DATABASE_URL = `postgres://mesto:${cfg.pgPassword}@127.0.0.1:${pgPort}/mesto`;

// ---------- 4. миграции и API ----------
const ownerOrigin = `http://localhost:${ownerPort}`;
// токен бота: переменная окружения TELEGRAM_BOT_TOKEN или файл data/bot-token.txt (в поставку не входит, в git не попадает)
const tokenFile = join(DATA, "bot-token.txt");
const botToken = (process.env.TELEGRAM_BOT_TOKEN || (existsSync(tokenFile) ? readFileSync(tokenFile, "utf8") : "")).trim();
if (botToken && !/^[0-9]{6,12}:[A-Za-z0-9_-]{30,}$/.test(botToken)) {
  await shutdown(false);
  await fail("Токен бота выглядит неверно (ожидается вид 123456789:AA...). Проверьте data/bot-token.txt или переменную TELEGRAM_BOT_TOKEN.");
}
say(botToken ? "Бот Telegram подключён: подтверждение аккаунта и оплата Stars включены." : "Бот Telegram не задан: подтверждение и оплата выключены (см. README-INSTALL.md).");
const env = {
  ...process.env,
  NODE_ENV: "production",
  DATABASE_URL,
  JWT_SECRET: cfg.jwtSecret,
  PORT: String(apiPort),
  HOST: "127.0.0.1",
  CORS_ORIGIN: ownerOrigin,
  APP_URL: ownerOrigin,
  TRUST_PROXY: "true",
  COOKIE_SECURE: "false", // локально работаем по http
  DOCS_ENABLED: "false",
  // Без бота подтверждение аккаунта и оплата выключены (приложение свободно). С ботом (токен из @BotFather) включаются
  // подтверждение через Telegram и оплата Stars (1 ★ = 1 день, от 14 дней). Бот работает через polling, публичный адрес не нужен.
  TELEGRAM_BOT_TOKEN: botToken,
  TELEGRAM_MODE: "polling",
  TELEGRAM_VERIFICATION: botToken ? "true" : "false",
};
say("Применяю обновления базы...");
const mig = spawnSync(process.execPath, ["migrate.js"], { cwd: API_DIR, env, stdio: "inherit" });
if (mig.status !== 0) {
  await shutdown(false);
  await fail("Не удалось подготовить базу данных (подробности выше).");
}

api = spawn(process.execPath, ["main.js"], { cwd: API_DIR, env, stdio: ["ignore", "ignore", "inherit"] });
api.on("exit", (code) => {
  if (!stopping) {
    console.error(`\n[X] Сервер неожиданно остановился (код ${code}).`);
    shutdown(false).then(() => process.exit(1));
  }
});

// ---------- 5. веб-сервер: статика + прокси /api ----------
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function serve(dir, port) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname.startsWith("/api/")) {
      const up = request(
        { host: "127.0.0.1", port: apiPort, method: req.method, path: req.url, headers: { ...req.headers, "x-forwarded-for": req.socket.remoteAddress ?? "127.0.0.1" } },
        (r) => {
          res.writeHead(r.statusCode ?? 502, r.headers);
          r.pipe(res);
        },
      );
      up.on("error", () => {
        if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: "UPSTREAM", message: "Сервер не отвечает" } }));
      });
      req.pipe(up);
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }
    let rel;
    try {
      rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
    } catch {
      res.writeHead(400).end();
      return;
    }
    let file = join(dir, rel);
    if (file !== dir && !file.startsWith(dir + sep)) {
      res.writeHead(403).end();
      return;
    }
    if (!existsSync(file) || statSync(file).isDirectory()) {
      file = extname(rel) ? "" : join(dir, "index.html"); // SPA: любой путь без расширения → index.html
    }
    if (!file || !existsSync(file)) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
      return;
    }
    const ext = extname(file).toLowerCase();
    const immutable = /[\\/]assets[\\/]/.test(file);
    res.writeHead(200, {
      "content-type": TYPES[ext] ?? "application/octet-stream",
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      "x-content-type-options": "nosniff",
    });
    if (req.method === "HEAD") res.end();
    else createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok(server)));
}
servers = [await serve(WEB.owner, ownerPort), await serve(WEB.cashier, cashierPort)];

// ждём готовности API
let ready = false;
for (let i = 0; i < 60 && !ready; i++) {
  ready = await new Promise((res) => {
    const r = request({ host: "127.0.0.1", port: apiPort, path: "/ready", timeout: 1500 }, (x) => (x.resume(), res(x.statusCode === 200)));
    r.on("error", () => res(false));
    r.on("timeout", () => (r.destroy(), res(false)));
    r.end();
  });
  if (!ready) await new Promise((r) => setTimeout(r, 1000));
}
if (!ready) {
  await shutdown(false);
  await fail("Сервер не запустился за минуту.");
}

say("");
say("[OK] MESTO запущен");
say(`  Кабинет владельца:   ${ownerOrigin}`);
say(`  Приложение кассира:  http://localhost:${cashierPort}`);
say(`  Данные:              ${DATA}`);
say("");
say("Не закрывайте это окно, пока работаете. Чтобы остановить — нажмите Ctrl+C или закройте окно.");
openBrowser(ownerOrigin);

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) process.on(sig, () => shutdown());

function openBrowser(url) {
  try {
    if (isWin) spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    else if (process.platform === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    else spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
  } catch {}
}
