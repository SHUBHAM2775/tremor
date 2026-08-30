from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from app.db import init_db
from app.routers import pages, clusters, health

from typing import Any, Dict
import os

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Run database schema initialization on startup
    init_db()
    yield

app = FastAPI(
    title="Tremor API",
    description="Real-time edit-war and conflict detector for Wikipedia.",
    version="1.0.0",
    lifespan=lifespan
)

# GZip compression for responses >= 1,000 bytes
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Configure CORS to allow communication with the Next.js frontend
origins = ["http://localhost:3000", "http://127.0.0.1:3000"]
extra_origins = os.getenv("CORS_ORIGINS")
if extra_origins:
    origins.extend([o.strip() for o in extra_origins.split(",") if o.strip()])

cors_kwargs: Dict[str, Any] = {
    "allow_origins": origins,
    "allow_credentials": True,
    "allow_methods": ["*"],
    "allow_headers": ["*"],
}

origin_regex = os.getenv("CORS_ORIGIN_REGEX")
if origin_regex:
    cors_kwargs["allow_origin_regex"] = origin_regex

app.add_middleware(CORSMiddleware, **cors_kwargs)

# Register routes
app.include_router(health.router)
app.include_router(pages.router)
app.include_router(clusters.router)

@app.get("/")
def read_root():
    return {
        "status": "online",
        "project": "Tremor",
        "description": "A seismograph for Wikipedia pages in active edit conflicts."
    }

