# Scania Oscar Voting (GitHub Pages + Google Sheets + Apps Script)

Стек:
- Frontend: GitHub Pages (статичний HTML/CSS/JS)
- Storage: Google Sheets
- Backend/API: Google Apps Script Web App
- GET: JSONP (обхід CORS)
- POST: HTML form submit

Сторінки:
- index.html — головна з QR
- vote.html — голосування (персональний токен або персональний лінк)
- results.html — результати (для адмінів через ?key=...)

Дані в репо:
- data/nominations.json — 9 номінацій (snake_case ids)
- data/films.json — 4 фільми з team
- data/people.json — 8–12 кандидатів-людей
- data/voters.csv — виборці (name,team)

Backend:
- apps-script/Code.gs — вставляється в Google Apps Script і деплоїться як Web App (/exec)
