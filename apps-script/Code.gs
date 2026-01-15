/**
 * Scania Oscar Voting — Apps Script Web App
 * GET: JSONP
 * POST: HTML form submit (без fetch, обхід CORS)
 */

const CONFIG = {
  // === ОБОВʼЯЗКОВО ЗАПОВНИТИ ===
  SPREADSHEET_ID: "PASTE_YOUR_GOOGLE_SHEET_ID_HERE",

  // Дуже довгий секрет (мін 32+ символи). Не публікуйте.
  ADMIN_KEY: "CHANGE_ME_TO_A_LONG_RANDOM_SECRET_64CHARS",

  // Reveal time: до цього моменту results заблоковані навіть для адмінів
  // Формат ISO 8601 з timezone offset (зручно для Києва +02/+03)
  REVEAL_AFTER_ISO: "2026-02-01T18:00:00+02:00",

  // Raw base URL репо:
  // Напр: https://raw.githubusercontent.com/<user>/<repo>/main
  GITHUB_RAW_BASE: "https://raw.githubusercontent.com/USERNAME/REPO/main",

  // Потрібно для генерації персональних лінків у TokenLinks
  // Напр: https://username.github.io/repo/vote.html
  VOTE_PAGE_URL: "https://USERNAME.github.io/REPO/vote.html",

  // === листи ===
  SHEET_VOTERS: "Voters",
  SHEET_VOTES: "Votes",
  SHEET_TOKEN_LINKS: "TokenLinks",

  // === шляхи в репо ===
  PATH_VOTERS_CSV: "/data/voters.csv",
  PATH_NOMINATIONS: "/data/nominations.json",
  PATH_PEOPLE: "/data/people.json",
  PATH_FILMS: "/data/films.json",

  // кеш довідників (сек)
  CACHE_SECONDS: 300
};

/** ========== WEB APP ENTRYPOINTS ========== */

function doGet(e) {
  try {
    const p = (e && e.parameter) ? e.parameter : {};
    const action = (p.action || "").trim();
    const callback = sanitizeCallback_(p.callback || "callback");

    if (!action) {
      return ContentService
        .createTextOutput(
          "Scania Oscar Voting Web App\n\n" +
          "GET JSONP:\n" +
          "  ?action=voter&t=TOKEN&callback=cb\n" +
          "  ?action=results&key=ADMIN_KEY&callback=cb\n"
        )
        .setMimeType(ContentService.MimeType.TEXT);
    }

    if (action === "voter") {
      const token = (p.t || "").trim();
      if (!token) return jsonp_(callback, { ok:false, error:"missing_token" });

      const voter = getVoterByToken_(token);
      if (!voter) return jsonp_(callback, { ok:false, error:"token_not_found" });

      return jsonp_(callback, {
        ok:true,
        voter:{
          name: voter.name,
          team: voter.team,
          alreadyVoted: !!voter.votedAt
        }
      });
    }

    if (action === "results") {
      const key = (p.key || "").trim();
      if (!key || key !== CONFIG.ADMIN_KEY) {
        return jsonp_(callback, { ok:false, error:"unauthorized" });
      }

      if (isLocked_()) {
        return jsonp_(callback, { ok:false, error:"locked", revealAfter: CONFIG.REVEAL_AFTER_ISO });
      }

      const aggregated = aggregateResults_();
      return jsonp_(callback, aggregated);
    }

    return jsonp_(callback, { ok:false, error:"unknown_action" });

  } catch (err) {
    const callback = sanitizeCallback_((e && e.parameter && e.parameter.callback) || "callback");
    return jsonp_(callback, { ok:false, error:"server_error", details:String(err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);

    const p = (e && e.parameter) ? e.parameter : {};
    const token = (p.t || "").trim();

    if (!token) return htmlResponse_("Помилка", "Відсутній токен (t).", false);

    const voter = getVoterByToken_(token);
    if (!voter) return htmlResponse_("Помилка", "Невалідний токен або токен не знайдено.", false);

    if (voter.votedAt) {
      return htmlResponse_("Помилка", "Цей токен вже голосував. Повторне голосування заборонено.", false);
    }

    const ref = getReferenceData_(); // nominations + maps from GitHub raw
    const nominations = ref.nominations;

    // 1) Перевірка: усі номінації заповнені
    const selections = {};
    const missing = [];
    nominations.forEach(n => {
      const key = "selection_" + n.id;
      const val = (p[key] || "").trim();
      if (!val) missing.push(n.title);
      else selections[n.id] = val;
    });
    if (missing.length) {
      return htmlResponse_("Помилка", "Заповніть усі номінації: " + missing.join(", "), false);
    }

    // 2) Перевірка: кандидат існує + тип + “не за свою команду”
    const voterTeam = (voter.team || "").trim();

    for (const n of nominations) {
      const candidateId = selections[n.id];
      let candidateTeam = "";
      if (n.type === "person") {
        const person = ref.peopleMap[candidateId];
        if (!person) return htmlResponse_("Помилка", `Невідомий кандидат (person): ${candidateId}`, false);
        candidateTeam = (person.team || "").trim();
      } else if (n.type === "film") {
        const film = ref.filmsMap[candidateId];
        if (!film) return htmlResponse_("Помилка", `Невідомий кандидат (film): ${candidateId}`, false);
        candidateTeam = (film.team || "").trim();
      } else {
        return htmlResponse_("Помилка", `Невідомий тип номінації: ${n.type}`, false);
      }

      // Заборона голосувати за свою команду
      if (voterTeam && candidateTeam && voterTeam === candidateTeam) {
        return htmlResponse_(
          "Помилка",
          `Заборонено голосувати за кандидата зі своєї команди (${voterTeam}).`,
          false
        );
      }
    }

    // 3) Запис голосів (9 рядків) + votedAt
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const votesSheet = ensureSheet_(ss, CONFIG.SHEET_VOTES, ["timestamp","token","nominationId","candidateId","candidateType"]);
    const votersSheet = ensureSheet_(ss, CONFIG.SHEET_VOTERS, ["token","name","team","votedAt"]);

    const nowIso = new Date().toISOString();

    const rows = nominations.map(n => ([
      nowIso,
      token,
      n.id,
      selections[n.id],
      n.type
    ]));

    const startRow = votesSheet.getLastRow() + 1;
    votesSheet.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);

    // update votedAt in Voters
    votersSheet.getRange(voter.rowIndex, 4).setValue(nowIso);

    return htmlResponse_("Дякуємо!", "Ваш голос прийнято ✅", true);

  } catch (err) {
    return htmlResponse_("Помилка", "Server error: " + String(err), false);
  } finally {
    try { lock.releaseLock(); } catch(_){}
  }
}

/** ========== ADMIN FUNCTIONS (RUN MANUALLY) ========== */

/**
 * adminSyncVotersAndGenerateTokens()
 * - Читає data/voters.csv з GitHub raw
 * - Очищує та заповнює лист Voters
 * - Генерує довгі токени
 */
function adminSyncVotersAndGenerateTokens() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ensureSheet_(ss, CONFIG.SHEET_VOTERS, ["token","name","team","votedAt"]);
  sheet.clearContents();
  sheet.getRange(1,1,1,4).setValues([["token","name","team","votedAt"]]);

  const csvText = fetchText_(CONFIG.GITHUB_RAW_BASE + CONFIG.PATH_VOTERS_CSV);
  const parsed = Utilities.parseCsv(csvText);

  // очікуємо: header name,team
  const rows = [];
  for (let i = 1; i < parsed.length; i++) {
    const name = (parsed[i][0] || "").trim();
    const team = (parsed[i][1] || "").trim();
    if (!name) continue;

    const token = generateToken_();
    rows.push([token, name, team, ""]);
  }

  if (!rows.length) throw new Error("No voters loaded from CSV");

  sheet.getRange(2,1,rows.length,4).setValues(rows);
}

/**
 * adminExportTokenLinks()
 * - Створює/оновлює лист TokenLinks з колонками name,team,token,link
 */
function adminExportTokenLinks() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const votersSheet = ensureSheet_(ss, CONFIG.SHEET_VOTERS, ["token","name","team","votedAt"]);
  const data = votersSheet.getDataRange().getValues();
  if (data.length < 2) throw new Error("Voters sheet is empty. Run adminSyncVotersAndGenerateTokens() first.");

  const out = ensureSheet_(ss, CONFIG.SHEET_TOKEN_LINKS, ["name","team","token","link"]);
  out.clearContents();
  out.getRange(1,1,1,4).setValues([["name","team","token","link"]]);

  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const token = String(data[i][0] || "").trim();
    const name = String(data[i][1] || "").trim();
    const team = String(data[i][2] || "").trim();
    if (!token || !name) continue;

    const link = CONFIG.VOTE_PAGE_URL + "?t=" + encodeURIComponent(token);
    rows.push([name, team, token, link]);
  }

  if (rows.length) out.getRange(2,1,rows.length,4).setValues(rows);
}

/** ========== INTERNAL HELPERS ========== */

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);

  // Ensure header row
  const firstRow = sh.getRange(1,1,1,headers.length).getValues()[0];
  const needHeader = firstRow.some((v,i) => String(v||"").trim() !== headers[i]);
  if (needHeader) {
    sh.getRange(1,1,1,headers.length).setValues([headers]);
  }
  return sh;
}

function getVoterByToken_(token) {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sh = ensureSheet_(ss, CONFIG.SHEET_VOTERS, ["token","name","team","votedAt"]);

  // find token in column A
  const finder = sh.getRange("A:A").createTextFinder(token).matchEntireCell(true);
  const cell = finder.findNext();
  if (!cell) return null;

  const rowIndex = cell.getRow();
  if (rowIndex === 1) return null; // header
  const row = sh.getRange(rowIndex, 1, 1, 4).getValues()[0];

  return {
    rowIndex,
    token: String(row[0]||"").trim(),
    name: String(row[1]||"").trim(),
    team: String(row[2]||"").trim(),
    votedAt: String(row[3]||"").trim()
  };
}

function getReferenceData_() {
  const cache = CacheService.getScriptCache();

  const nominationsStr = cache.get("nominations");
  const peopleStr = cache.get("people");
  const filmsStr = cache.get("films");

  let nominations, people, films;

  if (nominationsStr && peopleStr && filmsStr) {
    nominations = JSON.parse(nominationsStr);
    people = JSON.parse(peopleStr);
    films = JSON.parse(filmsStr);
  } else {
    nominations = fetchJson_(CONFIG.GITHUB_RAW_BASE + CONFIG.PATH_NOMINATIONS);
    people = fetchJson_(CONFIG.GITHUB_RAW_BASE + CONFIG.PATH_PEOPLE);
    films = fetchJson_(CONFIG.GITHUB_RAW_BASE + CONFIG.PATH_FILMS);

    cache.put("nominations", JSON.stringify(nominations), CONFIG.CACHE_SECONDS);
    cache.put("people", JSON.stringify(people), CONFIG.CACHE_SECONDS);
    cache.put("films", JSON.stringify(films), CONFIG.CACHE_SECONDS);
  }

  // Maps by id
  const peopleMap = {};
  people.forEach(p => { peopleMap[p.id] = p; });

  const filmsMap = {};
  films.forEach(f => { filmsMap[f.id] = f; });

  // Номінації як є (очікуємо 9)
  if (!Array.isArray(nominations) || nominations.length !== 9) {
    throw new Error("Expected 9 nominations in nominations.json");
  }

  return { nominations, peopleMap, filmsMap };
}

function aggregateResults_() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const votesSheet = ensureSheet_(ss, CONFIG.SHEET_VOTES, ["timestamp","token","nominationId","candidateId","candidateType"]);
  const values = votesSheet.getDataRange().getValues();

  // header: [timestamp, token, nominationId, candidateId, candidateType]
  const counts = {};
  const tokenSet = new Set();

  for (let i = 1; i < values.length; i++) {
    const nominationId = String(values[i][2] || "").trim();
    const candidateId  = String(values[i][3] || "").trim();
    const token        = String(values[i][1] || "").trim();

    if (!nominationId || !candidateId) continue;
    tokenSet.add(token);

    if (!counts[nominationId]) counts[nominationId] = {};
    counts[nominationId][candidateId] = (counts[nominationId][candidateId] || 0) + 1;
  }

  return {
    ok: true,
    counts,
    meta: {
      totalVoteRows: Math.max(0, values.length - 1),
      totalBallots: tokenSet.size,
      updatedAt: new Date().toISOString()
    }
  };
}

function isLocked_() {
  const now = new Date();
  const reveal = new Date(CONFIG.REVEAL_AFTER_ISO);
  return now.getTime() < reveal.getTime();
}

function jsonp_(callback, obj) {
  const out = `${callback}(${JSON.stringify(obj)});`;
  return ContentService.createTextOutput(out)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function sanitizeCallback_(cb) {
  cb = String(cb || "callback").trim();
  // allow only JS identifier-ish
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(cb)) return "callback";
  return cb;
}

function fetchJson_(url) {
  const txt = fetchText_(url);
  return JSON.parse(txt);
}

function fetchText_(url) {
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  const code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error("Fetch failed " + code + " for " + url + ": " + res.getContentText().slice(0, 200));
  }
  return res.getContentText();
}

function generateToken_() {
  // Довгий токен із 2 UUID (128-біт * 2 = 256-біт у hex) → 64 hex chars * 2 = 64? (UUID без дефісів = 32)
  const a = Utilities.getUuid().replace(/-/g,"");
  const b = Utilities.getUuid().replace(/-/g,"");
  const c = Utilities.getUuid().replace(/-/g,"");
  return (a + b + c); // 96 hex chars
}

function htmlResponse_(title, message, ok) {
  const color = ok ? "#2fe38b" : "#ff5c5c";
  const btnBg = ok ? "#FFC72C" : "rgba(255,255,255,.12)";
  const btnColor = ok ? "#000" : "#fff";

  const backUrl = CONFIG.VOTE_PAGE_URL; // без токена; зручно повернутись/вставити токен заново

  const html = `
<!doctype html>
<html lang="uk">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${escapeHtml_(title)}</title>
  <style>
    :root{--bg:#000;--text:#fff;--muted:rgba(255,255,255,.65);--gold:#FFC72C;}
    body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,"SF Pro Display",Segoe UI,Roboto,Arial,sans-serif;
      display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
    .card{max-width:720px;width:100%;border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:18px;background:rgba(255,255,255,.06)}
    .kicker{color:var(--gold);letter-spacing:.28em;text-transform:uppercase;font-weight:900;font-size:12px}
    h1{margin:10px 0 8px;letter-spacing:-.03em}
    p{margin:0;color:var(--muted);line-height:1.45}
    .msg{margin-top:12px;padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,.12);color:${color};background:rgba(0,0,0,.35)}
    a{display:inline-flex;margin-top:14px;padding:12px 14px;border-radius:14px;text-decoration:none;background:${btnBg};color:${btnColor};font-weight:800}
  </style>
</head>
<body>
  <div class="card">
    <div class="kicker">Scania Oscar</div>
    <h1>${escapeHtml_(title)}</h1>
    <div class="msg">${escapeHtml_(message)}</div>
    <a href="${backUrl}">Повернутись</a>
  </div>
</body>
</html>`;
  return HtmlService.createHtmlOutput(html);
}

function escapeHtml_(s){
  return String(s).replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[ch]));
}

