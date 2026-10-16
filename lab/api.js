// Thin typed client for the PHASES laboratory API (see docs/api.md).

export class ApiError extends Error {
  constructor(status, detail) {
    super(typeof detail === "string" ? detail : `Request failed (${status})`);
    this.status = status;
    this.detail = detail;
  }
}

export class Api {
  constructor(base) {
    this.base = base.replace(/\/+$/, "");
  }

  async req(path, { method = "GET", body, timeout = 8000 } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(`${this.base}/api/v1${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
      if (!res.ok) throw new ApiError(res.status, data?.detail ?? res.statusText);
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  health() { return this.req("/health", { timeout: 2500 }); }
  models() { return this.req("/models"); }
  createExperiment(body) { return this.req("/experiments", { method: "POST", body }); }
  experiments() { return this.req("/experiments?limit=200"); }
  experiment(id) { return this.req(`/experiments/${id}`); }
  startRun(id, body) { return this.req(`/experiments/${id}/runs`, { method: "POST", body }); }
  run(id) { return this.req(`/runs/${id}`); }
  control(id, action) { return this.req(`/runs/${id}/${action}`, { method: "POST" }); }
  metrics(id) { return this.req(`/runs/${id}/metrics`); }
  frames(id) { return this.req(`/runs/${id}/frames?limit=5000`, { timeout: 30000 }); }
  csvUrl(id) { return `${this.base}/api/v1/runs/${id}/metrics?format=csv`; }
  bundleUrl(id) { return `${this.base}/api/v1/runs/${id}/bundle`; }

  /** Open the live stream. handlers: {onEvent(event), onClose()} */
  stream(runId, { onEvent, onClose }) {
    const ws = new WebSocket(`${this.base.replace(/^http/, "ws")}/ws/runs/${runId}`);
    ws.onmessage = (m) => onEvent(JSON.parse(m.data));
    ws.onclose = () => onClose && onClose();
    return ws;
  }
}
