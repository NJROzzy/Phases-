// Where the laboratory API lives.
//   ?api=http://host:port   use (and remember) this API
//   ?api=                   forget it and use demo mode
// On localhost the default is the local API; elsewhere demo mode, until the
// visitor connects one.

const KEY = "phases-api";

function read() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function setApiBase(url) {
  try {
    if (url) localStorage.setItem(KEY, url);
    else localStorage.removeItem(KEY);
  } catch {}
}

export function apiBase() {
  const param = new URLSearchParams(location.search).get("api");
  if (param !== null) {
    setApiBase(param);
    return param || null;
  }
  const saved = read();
  if (saved) return saved;
  if (["localhost", "127.0.0.1"].includes(location.hostname)) return "http://127.0.0.1:8000";
  return null;
}
