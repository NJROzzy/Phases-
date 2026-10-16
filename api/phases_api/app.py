"""HTTP and WebSocket routes.

Run locally:  python -m phases_api   (or: uvicorn phases_api.app:create_app --factory)
Docs:         http://localhost:8000/docs
"""

from __future__ import annotations

import asyncio
import csv
import gzip
import io
import json
import zipfile
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import ValidationError
from sqlalchemy.orm import Session

from phases_engine import __version__ as engine_version
from phases_engine import get_model, list_models
from phases_engine.core.record import config_hash

from . import __version__
from .db import Experiment, Run, make_sessionmaker
from .live import FINAL, RunManager
from .schemas import ControlAction, ExperimentCreate, ExperimentDetail, ExperimentOut, ModelInfo, RunCreate, RunOut
from .settings import Settings


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    settings.runs_dir.mkdir(parents=True, exist_ok=True)
    sessions = make_sessionmaker(settings.db_url)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        manager = RunManager(sessions, settings.runs_dir, settings.max_concurrent_runs, asyncio.get_running_loop())
        manager.recover()
        app.state.runs = manager
        yield
        manager.shutdown()

    app = FastAPI(
        title="PHASES Laboratory API",
        version=__version__,
        description="Create experiments, run simulations through the six phases, stream them live, and export reproducible records.",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )

    def db():
        with sessions() as s:
            yield s

    def manager(request: Request) -> RunManager:
        return request.app.state.runs

    def get_experiment(s: Session, experiment_id: str) -> Experiment:
        exp = s.get(Experiment, experiment_id)
        if exp is None:
            raise HTTPException(404, "experiment not found")
        return exp

    def get_run(s: Session, run_id: str) -> Run:
        run = s.get(Run, run_id)
        if run is None:
            raise HTTPException(404, "run not found")
        return run

    api = APIRouter(prefix="/api/v1")

    # ------------------------------------------------------------ meta
    @api.get("/health")
    def health():
        return {"ok": True, "api_version": __version__, "engine_version": engine_version}

    @api.get("/models", response_model=list[ModelInfo])
    def models():
        return [m.describe() for m in list_models()]

    # ------------------------------------------------------------ experiments
    @api.post("/experiments", response_model=ExperimentOut, status_code=201)
    def create_experiment(body: ExperimentCreate, s: Session = Depends(db)):
        try:
            model = get_model(body.model)
        except KeyError as e:
            raise HTTPException(422, str(e.args[0]))
        try:
            cfg = model.Config.model_validate(body.config)
        except ValidationError as e:
            raise HTTPException(422, json.loads(e.json(include_url=False)))
        if cfg.max_steps > settings.max_steps_limit:
            raise HTTPException(422, f"max_steps is limited to {settings.max_steps_limit} on this server")
        config = cfg.model_dump(mode="json")

        exp = Experiment(
            title=body.title,
            hypothesis=body.hypothesis,
            model_id=model.id,
            model_version=model.version,
            config=config,
            config_hash=config_hash(model.id, model.version, config),
            seed=body.seed,
            change_note=body.change_note,
            change_origin=body.change_origin,
            engine_version=engine_version,
        )
        if body.parent_id:
            parent = get_experiment(s, body.parent_id)
            exp.parent_id = parent.id
            exp.cycle_index = parent.cycle_index + 1
            exp.change_from_parent = {
                k: {"from": parent.config.get(k), "to": v} for k, v in config.items() if parent.config.get(k) != v
            }
            if parent.model_id != model.id:
                exp.change_from_parent["model"] = {"from": parent.model_id, "to": model.id}
        s.add(exp)
        s.commit()
        return exp

    @api.get("/experiments", response_model=list[ExperimentOut])
    def list_experiments(
        parent_id: str | None = None,
        limit: int = Query(50, ge=1, le=500),
        offset: int = Query(0, ge=0),
        s: Session = Depends(db),
    ):
        q = s.query(Experiment)
        if parent_id:
            q = q.filter(Experiment.parent_id == parent_id)
        return q.order_by(Experiment.created_at.desc(), Experiment.id.desc()).offset(offset).limit(limit).all()

    @api.get("/experiments/{experiment_id}", response_model=ExperimentDetail)
    def experiment_detail(experiment_id: str, s: Session = Depends(db)):
        exp = get_experiment(s, experiment_id)
        children = [c.id for c in s.query(Experiment.id).filter(Experiment.parent_id == exp.id)]
        return {**ExperimentOut.model_validate(exp).model_dump(), "runs": exp.runs, "children": children}

    # ------------------------------------------------------------ runs
    @api.post("/experiments/{experiment_id}/runs", response_model=RunOut, status_code=202)
    def start_run(experiment_id: str, body: RunCreate | None = None, s: Session = Depends(db), m: RunManager = Depends(manager)):
        body = body or RunCreate()
        exp = get_experiment(s, experiment_id)
        run = Run(experiment_id=exp.id, seed=exp.seed if body.seed is None else body.seed, frame_every=body.frame_every)
        s.add(run)
        s.commit()
        m.start(run, exp.model_id, exp.config, body.steps_per_second)
        return run

    @api.get("/runs/{run_id}", response_model=RunOut)
    def run_detail(run_id: str, s: Session = Depends(db)):
        return get_run(s, run_id)

    def _control(run_id: str, action: str, s: Session, m: RunManager) -> ControlAction:
        run = get_run(s, run_id)
        if run.status in FINAL:
            raise HTTPException(409, f"run already {run.status}")
        try:
            return ControlAction(ok=True, status=m.control(run_id, action))
        except LookupError as e:
            raise HTTPException(409, str(e))

    @api.post("/runs/{run_id}/pause", response_model=ControlAction)
    def pause(run_id: str, s: Session = Depends(db), m: RunManager = Depends(manager)):
        return _control(run_id, "pause", s, m)

    @api.post("/runs/{run_id}/resume", response_model=ControlAction)
    def resume(run_id: str, s: Session = Depends(db), m: RunManager = Depends(manager)):
        return _control(run_id, "resume", s, m)

    @api.post("/runs/{run_id}/cancel", response_model=ControlAction)
    def cancel(run_id: str, s: Session = Depends(db), m: RunManager = Depends(manager)):
        return _control(run_id, "cancel", s, m)

    def _run_file(run_id: str, name: str) -> Path:
        path = settings.runs_dir / run_id / name
        if not path.exists():
            raise HTTPException(404, f"{name} not available yet")
        return path

    @api.get("/runs/{run_id}/metrics")
    def metrics(run_id: str, format: str = Query("json", pattern="^(json|csv)$"), s: Session = Depends(db)):
        run = get_run(s, run_id)
        if format == "csv":
            return FileResponse(_run_file(run.id, "metrics.csv"), media_type="text/csv", filename=f"phases-{run.id}-metrics.csv")
        series: dict[str, list] = {}
        with open(_run_file(run.id, "metrics.csv"), newline="") as f:
            for row in csv.DictReader(f):
                for k, v in row.items():
                    series.setdefault(k, []).append(None if v == "" else float(v))
        return {"run_id": run.id, "steps": run.steps, "series": series}

    @api.get("/runs/{run_id}/frames")
    def frames(
        run_id: str,
        start: int = Query(0, ge=0, alias="from"),
        end: int | None = Query(None, ge=0, alias="to"),
        limit: int = Query(500, ge=1, le=5000),
        s: Session = Depends(db),
    ):
        run = get_run(s, run_id)
        out = []
        with gzip.open(_run_file(run.id, "frames.jsonl.gz"), "rt") as f:
            for line in f:
                fr = json.loads(line)
                if fr["step"] < start or (end is not None and fr["step"] > end):
                    continue
                out.append(fr)
                if len(out) >= limit:
                    break
        return {"run_id": run.id, "frame_every": run.frame_every, "frames": out}

    @api.get("/runs/{run_id}/bundle")
    def bundle(run_id: str, s: Session = Depends(db)):
        run = get_run(s, run_id)
        if run.status not in FINAL:
            raise HTTPException(409, "run has not finished")
        exp = run.experiment
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("experiment.json", ExperimentOut.model_validate(exp).model_dump_json(indent=2))
            z.writestr("run_status.json", RunOut.model_validate(run).model_dump_json(indent=2))
            for name in ("run.json", "metrics.csv", "frames.jsonl.gz"):
                path = settings.runs_dir / run.id / name
                if path.exists():
                    z.write(path, name)
            z.writestr("README.md", _bundle_readme(exp, run))
        buf.seek(0)
        return StreamingResponse(
            buf, media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="phases-{run.id}.zip"'}
        )

    # ------------------------------------------------------------ live stream
    @app.websocket("/ws/runs/{run_id}")
    async def live(websocket: WebSocket, run_id: str):
        await websocket.accept()
        with sessions() as s:
            run = s.get(Run, run_id)
            snapshot = RunOut.model_validate(run).model_dump() if run else None
        if snapshot is None:
            await websocket.close(code=4404, reason="run not found")
            return
        m: RunManager = websocket.app.state.runs
        q, livestate = m.hub.subscribe(run_id)
        try:
            hello = {"type": "hello", "run": snapshot, "rows": [], "frame": None}
            if livestate is not None:
                hello.update(rows=list(livestate.rows), frame=livestate.frame)
                hello["run"].update(status=livestate.status, phase=livestate.phase)
            await websocket.send_text(json.dumps(hello))
            if livestate is None:  # finished (or never started): nothing more will come
                await websocket.close()
                return
            while True:
                event = await q.get()
                await websocket.send_text(json.dumps(event))
                if event["type"] in ("done", "error"):
                    await websocket.close()
                    return
        except WebSocketDisconnect:
            pass
        finally:
            m.hub.unsubscribe(run_id, q)

    app.include_router(api)
    return app


def _bundle_readme(exp: Experiment, run: Run) -> str:
    return f"""# PHASES run {run.id}

Experiment: {exp.title} (cycle {exp.cycle_index})
Hypothesis: {exp.hypothesis or "(none stated)"}
Model: {exp.model_id} v{exp.model_version}, engine v{exp.engine_version}
Seed: {run.seed}
Status: {run.status} ({run.termination_reason}), {run.steps} steps
Config hash:  {exp.config_hash}
Metrics hash: {run.metrics_hash}

Files
- experiment.json: hypothesis, parameters and lineage
- run.json: full run record (environment, phase log, summary, invariant checks)
- metrics.csv: one row per step
- frames.jsonl.gz: sampled world snapshots (every {run.frame_every} steps)

Reproduce
    pip install -e engine
    python -c "import json; json.dump(json.load(open('experiment.json'))['config'], open('config.json', 'w'))"
    python -m phases_engine run {exp.model_id} --seed {run.seed} --config config.json

The printed metrics_hash should match the one above on the same platform and
library versions (see run.json → environment).
"""

