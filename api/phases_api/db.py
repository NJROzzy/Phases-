"""Persistence: SQLite through SQLAlchemy (swap the URL for Postgres later)."""

from __future__ import annotations

import os
import time
from datetime import datetime, timezone

from sqlalchemy import JSON, ForeignKey, Integer, String, Text, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker

_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def new_id() -> str:
    """ULID: 48-bit millisecond timestamp + 80 random bits. Sorts by creation time."""
    value = (int(time.time() * 1000) << 80) | int.from_bytes(os.urandom(10), "big")
    return "".join(_CROCKFORD[(value >> (5 * i)) & 31] for i in reversed(range(26)))


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class Base(DeclarativeBase):
    pass


class Experiment(Base):
    __tablename__ = "experiments"

    id: Mapped[str] = mapped_column(String(26), primary_key=True, default=new_id)
    title: Mapped[str] = mapped_column(String(200))
    hypothesis: Mapped[str] = mapped_column(Text, default="")
    model_id: Mapped[str] = mapped_column(String(64))
    model_version: Mapped[str] = mapped_column(String(32))
    config: Mapped[dict] = mapped_column(JSON)
    config_hash: Mapped[str] = mapped_column(String(64))
    seed: Mapped[int] = mapped_column(Integer, default=0)
    parent_id: Mapped[str | None] = mapped_column(ForeignKey("experiments.id"), nullable=True)
    cycle_index: Mapped[int] = mapped_column(Integer, default=0)
    change_from_parent: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    change_note: Mapped[str] = mapped_column(Text, default="")
    change_origin: Mapped[str] = mapped_column(String(16), default="human")
    engine_version: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[str] = mapped_column(String(32), default=utcnow)

    runs: Mapped[list["Run"]] = relationship(back_populates="experiment", order_by="Run.created_at")


class Run(Base):
    __tablename__ = "runs"

    id: Mapped[str] = mapped_column(String(26), primary_key=True, default=new_id)
    experiment_id: Mapped[str] = mapped_column(ForeignKey("experiments.id"), index=True)
    seed: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), default="queued")
    phase: Mapped[str] = mapped_column(String(16), default="conception")
    steps: Mapped[int] = mapped_column(Integer, default=0)
    termination_reason: Mapped[str | None] = mapped_column(String(64), nullable=True)
    metrics_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    summary: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    environment: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    violations: Mapped[list | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    frame_every: Mapped[int] = mapped_column(Integer, default=5)
    created_at: Mapped[str] = mapped_column(String(32), default=utcnow)
    started_at: Mapped[str | None] = mapped_column(String(32), nullable=True)
    finished_at: Mapped[str | None] = mapped_column(String(32), nullable=True)

    experiment: Mapped[Experiment] = relationship(back_populates="runs")


def make_sessionmaker(url: str) -> sessionmaker:
    engine = create_engine(url, connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _pragmas(conn, _):
        cur = conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    Base.metadata.create_all(engine)
    return sessionmaker(engine, expire_on_commit=False)
