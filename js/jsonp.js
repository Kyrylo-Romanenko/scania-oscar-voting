// JSONP helper: додає <script> і чекає callback(...)
window.jsonpRequest = function jsonpRequest(url, timeoutMs = 12000){
  return new Promise((resolve, reject) => {
    const cbName = "__cb_" + Math.random().toString(36).slice(2);
    const u = new URL(url);

    // якщо callback не передали — додамо
    if (!u.searchParams.get("callback")) u.searchParams.set("callback", cbName);

    const script = document.createElement("script");
    let done = false;

    const cleanup = () => {
      if (script.parentNode) script.parentNode.removeChild(script);
      try { delete window[cbName]; } catch(_) { window[cbName] = undefined; }
    };

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error("JSONP timeout"));
    }, timeoutMs);

    window[cbName] = (data) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cleanup();
      reject(new Error("JSONP network error"));
    };

    script.src = u.toString();
    document.head.appendChild(script);
  });
};

