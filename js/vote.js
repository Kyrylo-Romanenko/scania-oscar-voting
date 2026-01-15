(async function(){
  const badge = document.getElementById("voterBadge");
  const topMsg = document.getElementById("topMsg");
  const tokenGate = document.getElementById("tokenGate");
  const tokenInput = document.getElementById("tokenInput");
  const tokenBtn = document.getElementById("tokenBtn");

  const form = document.getElementById("voteForm");
  const tokenHidden = document.getElementById("tokenHidden");
  const fieldsWrap = document.getElementById("formFields");
  const submitBtn = document.getElementById("submitBtn");

  const APPS_URL = (window.APP_CONFIG && window.APP_CONFIG.APPS_SCRIPT_EXEC_URL) || "";
  if (!APPS_URL || APPS_URL.includes("PASTE_")) {
    showTop("err", "Не налаштовано APPS_SCRIPT_EXEC_URL у js/config.js");
    badge.textContent = "Помилка конфігурації";
    return;
  }

  const params = new URLSearchParams(location.search);
  const token = (params.get("t") || "").trim();

  if (!token) {
    badge.textContent = "Потрібен токен";
    tokenGate.style.display = "block";
    tokenBtn.addEventListener("click", () => {
      const t = (tokenInput.value || "").trim();
      if (!t) return;
      location.href = "vote.html?t=" + encodeURIComponent(t);
    });
    return;
  }

  // JSONP: voter info
  badge.textContent = "Перевірка токена…";
  let voterResp;
  try{
    const url = new URL(APPS_URL);
    url.searchParams.set("action","voter");
    url.searchParams.set("t", token);
    voterResp = await window.jsonpRequest(url.toString());
  }catch(e){
    showTop("err","Не вдалося зв’язатися з сервером (JSONP). Перевірте /exec URL та доступність деплою.");
    badge.textContent = "Сервер недоступний";
    return;
  }

  if (!voterResp || voterResp.ok !== true) {
    const err = (voterResp && voterResp.error) ? voterResp.error : "Невідома помилка";
    showTop("err","Токен невалідний або недоступний: " + err);
    badge.textContent = "Токен невалідний";
    return;
  }

  const voter = voterResp.voter || {};
  const voterName = voter.name || "—";
  const voterTeam = (voter.team || "").trim();
  const alreadyVoted = !!voter.alreadyVoted;

  badge.textContent = `Виборець: ${voterName}` + (voterTeam ? ` • ${voterTeam}` : "");
  tokenHidden.value = token;

  if (alreadyVoted) {
    showTop("err", "Цей токен вже голосував. Повторне голосування заборонено.");
    form.style.display = "none";
    return;
  }

  // Load dictionaries from GitHub Pages (same origin)
  let nominations, people, films;
  try{
    [nominations, people, films] = await Promise.all([
      fetchJson("data/nominations.json"),
      fetchJson("data/people.json"),
      fetchJson("data/films.json"),
    ]);
  }catch(e){
    showTop("err","Не вдалося завантажити довідники з GitHub Pages (/data/*). Перевірте, що файли існують.");
    return;
  }

  // Build candidate lists
  const peopleFiltered = filterByTeam(people, voterTeam);
  const filmsFiltered  = filterByTeam(films, voterTeam);

  // Render form fields
  fieldsWrap.innerHTML = "";
  nominations.forEach(n => {
    const id = n.id;
    const title = n.title;
    const type = n.type;

    const candidates = (type === "person") ? peopleFiltered : filmsFiltered;

    const label = document.createElement("label");
    label.textContent = title;

    const select = document.createElement("select");
    select.name = "selection_" + id;
    select.required = true;

    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "— Оберіть —";
    opt0.disabled = true;
    opt0.selected = true;
    select.appendChild(opt0);

    candidates.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.id;
      const team = (c.team || "").trim();
      const nameOrTitle = c.name || c.title || c.id;
      opt.textContent = team ? `${nameOrTitle} — ${team}` : nameOrTitle;
      select.appendChild(opt);
    });

    const hint = document.createElement("small");
    hint.className = "hint";
    if (voterTeam) {
      hint.textContent = "Кандидати з вашої команди приховані.";
    } else {
      hint.textContent = "У вас не вказана команда — обмеження “не за свою команду” не застосовується.";
    }

    fieldsWrap.appendChild(label);
    fieldsWrap.appendChild(select);
    fieldsWrap.appendChild(hint);
  });

  // Form wiring
  form.action = APPS_URL;    // POST -> Apps Script
  form.method = "POST";
  form.acceptCharset = "utf-8";
  form.style.display = "block";

  form.addEventListener("submit", (ev) => {
    // додаткова фронт-перевірка (required і так спрацює)
    const missing = [];
    nominations.forEach(n => {
      const el = form.querySelector(`[name="selection_${n.id}"]`);
      if (!el || !el.value) missing.push(n.title);
    });
    if (missing.length) {
      ev.preventDefault();
      showTop("err", "Заповніть усі номінації: " + missing.join(", "));
      return;
    }

    // (Опційно) блокуємо кнопку від повторного кліку
    submitBtn.disabled = true;
    submitBtn.textContent = "Відправляємо…";
  });

  // Helpers
  function showTop(kind, text){
    topMsg.style.display = "block";
    topMsg.className = "msg " + (kind === "ok" ? "ok" : kind === "err" ? "err" : "");
    topMsg.textContent = text;
    topMsg.scrollIntoView({behavior:"smooth", block:"start"});
  }

  function filterByTeam(list, team){
    if (!team) return list.slice();
    return list.filter(x => (x.team || "").trim() !== team);
  }

  async function fetchJson(path){
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  }

})();

