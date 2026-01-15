// === CONFIG ===
// 1) Вставте сюди URL вашого Apps Script Web App (закінчується на /exec)
window.APP_CONFIG = {
  APPS_SCRIPT_EXEC_URL: "PASTE_YOUR_APPS_SCRIPT_EXEC_URL_HERE"
};

// 2) Допоміжне: базова URL-адреса GitHub Pages цього репо
window.getSiteBase = function getSiteBase(){
  // Напр. https://username.github.io/repo/
  const u = new URL(window.location.href);
  // прибрати файл (index.html/vote.html/results.html)
  u.pathname = u.pathname.replace(/[^/]+\.html$/, "");
  return u.toString();
};

