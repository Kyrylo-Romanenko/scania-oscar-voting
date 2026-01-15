(async function(){
  const msg = document.getElementById("msg");
  const wrap = document.getElementById("resultsWrap");
  const kpi = document.getElementById("kpi");

  const APPS_URL = (window.APP_CONFIG && window.APP_CONFIG.APPS_SCRIPT_EXEC_URL) || "";
  if (!APPS_URL || APPS_URL.includes("PASTE_")) {
    setMsg("err", "Не налаштовано APPS_SCRIPT_EXEC_URL у js/config.js");
    return;
  }

  const params = new URLSearchParams(location.search);
  const key = (params.get("key") || "").trim();
  if (!key) {
    setMsg("err", "Додайте ключ: results.html?key=ADMIN_KEY");
    return;
  }

  // JSONP results
  let resp;
  try{
    const url = new URL(APPS_URL);
    url.searchParams.set("action","results");
    url.searchParams.set("key", key);
    resp = await window.jsonpRequest(url.toString(), 15000);
  }catch(e){
    setMsg("err", "Не вдалося отримати результати (JSONP). Перевірте /exec URL та деплой.");
    return;
  }

  if (!resp || resp.ok !== true) {
    const err = (resp && resp.error) ? resp.error : "Невідома помилка";
    if (err === "locked") {
      setMsg("err", `Результати ще закриті. Reveal після: ${resp.revealAfter || "—"}`);
    } else if (err === "unauthorized") {
      setMsg("err", "Невірний ADMIN_KEY.");
    } else {
      setMsg("err", "Помилка: " + err);
    }
    return;
  }

  // Load dictionaries (GitHub Pages)
  let nominations, people, films;
  try{
    [nominations, people, films] = await Promise.all([
      fetchJson("data/nominations.json"),
      fetchJson("data/people.json"),
      fetchJson("data/films.json"),
    ]);
  }catch(e){
    setMsg("err","Не вдалося завантажити довідники з GitHub Pages (/data/*).");
    return;
  }

  const peopleMap = new Map(people.map(p => [p.id, p]));
  const filmsMap  = new Map(films.map(f => [f.id, f]));

  const counts = resp.counts || {};
  const meta = resp.meta || {};

  // KPI
  const totalBallots = meta.totalBallots || 0;
  const totalRows = meta.totalVoteRows || 0;
  const updatedAt = meta.updatedAt || "";

  kpi.style.display = "grid";
  kpi.innerHTML = `
    <div class="box"><div class="k">Унікальних токенів (бюлетенів)</div><div class="v">${totalBallots}</div></div>
    <div class="box"><div class="k">Записів у Votes (рядків)</div><div class="v">${totalRows}</div></div>
    <div class="box"><div class="k">Оновлено</div><div class="v" style="font-size:14px; line-height:1.25; font-weight:700">${escapeHtml(updatedAt)}</div></div>
    <div class="box"><div class="k">Номінацій</div><div class="v">${nominations.length}</div></div>
  `;
  setMsg("ok", "Результати завантажено ✅");

  // Render per nomination
  wrap.innerHTML = "";
  nominations.forEach(n => {
    const nomId = n.id;
    const nomCounts = counts[nomId] || {};
    const rows = Object.entries(nomCounts).map(([candidateId, c]) => {
      const obj = (n.type === "person") ? peopleMap.get(candidateId) : filmsMap.get(candidateId);
      const name = obj ? (obj.name || obj.title || candidateId) : candidateId;
      const team = obj ? (obj.team || "") : "";
      return { candidateId, name, team, votes: Number(c) || 0 };
    });

    rows.sort((a,b) => b.votes - a.votes || a.name.localeCompare(b.name, "uk"));

    const section = document.createElement("div");
    section.style.marginBottom = "16px";

    const h = document.createElement("h3");
    h.style.margin = "0 0 10px";
    h.style.letterSpacing = "-0.02em";
    h.innerHTML = `${escapeHtml(n.title)} <span style="color:rgba(255,255,255,.45); font-size:12px; font-weight:700">(${nomId})</span>`;

    const table = document.createElement("table");
    table.className = "table";
    table.innerHTML = `
      <thead>
        <tr>
          <th style="width:70px;">#</th>
          <th>Кандидат</th>
          <th style="width:34%;">Команда</th>
          <th style="width:120px;">Голоси</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r, idx) => `
          <tr>
            <td>${idx+1}</td>
            <td>${escapeHtml(r.name)}</td>
            <td>${escapeHtml(r.team || "—")}</td>
            <td><b>${r.votes}</b></td>
          </tr>
        `).join("")}
      </tbody>
    `;

    section.appendChild(h);
    section.appendChild(table);
    wrap.appendChild(section);
  });

  // Helpers
  function setMsg(kind, text){
    msg.className = "msg " + (kind === "ok" ? "ok" : kind === "err" ? "err" : "");
    msg.textContent = text;
  }
  async function fetchJson(path){
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  }
  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, ch => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[ch]));
  }

})();

