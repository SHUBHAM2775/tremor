from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.db import init_db
from app.routers import pages, clusters

import os

app = FastAPI(
    title="Tremor API",
    description="Real-time edit-war and conflict detector for Wikipedia.",
    version="1.0.0"
)

# Configure CORS to allow communication with the Next.js frontend
origins = ["http://localhost:3000", "http://127.0.0.1:3000"]
extra_origins = os.getenv("CORS_ORIGINS")
if extra_origins:
    origins.extend([o.strip() for o in extra_origins.split(",") if o.strip()])

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routes
app.include_router(pages.router)
app.include_router(clusters.router)

@app.get("/")
def read_root():
    return {
        "status": "online",
        "project": "Tremor",
        "description": "A seismograph for Wikipedia pages in active edit conflicts."
    }

@app.get("/health")
def health_check():
    return {"status": "healthy"}

# Run database schema initialization on startup
@app.on_event("startup")
def on_startup():
    init_db()
