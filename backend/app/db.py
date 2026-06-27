import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.models import Base

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./dev.db")
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# SQLite and PostgreSQL connection arguments
connect_args = {}
if DATABASE_URL.startswith("sqlite") or "sqlite" in DATABASE_URL:
    connect_args = {"check_same_thread": False, "timeout": 30}
elif "postgresql" in DATABASE_URL or DATABASE_URL.startswith("postgres"):
    connect_args = {"connect_timeout": 10}

engine = create_engine(DATABASE_URL, connect_args=connect_args)

# Enable SQLite Write-Ahead Logging (WAL) mode for concurrent read/write support
if engine.dialect.name == "sqlite":
    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        try:
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL;")
            cursor.execute("PRAGMA synchronous=NORMAL;")
            cursor.execute("PRAGMA busy_timeout=10000;")  # retry writes for 10s before failing
            cursor.close()
        except Exception:
            pass

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    Base.metadata.create_all(bind=engine)
    print(f"Tables created at: {DATABASE_URL}")


if __name__ == "__main__":
    init_db()