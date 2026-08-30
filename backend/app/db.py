import os
from typing import Any, Dict
from dotenv import load_dotenv
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.models import Base

load_dotenv(override=True)

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./dev.db")
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# SQLite and PostgreSQL connection arguments
connect_args = {}
if DATABASE_URL.startswith("sqlite") or "sqlite" in DATABASE_URL:
    connect_args = {"check_same_thread": False, "timeout": 30}
elif "postgresql" in DATABASE_URL or DATABASE_URL.startswith("postgres"):
    connect_args = {"connect_timeout": 10}

engine_kwargs: Dict[str, Any] = {"connect_args": connect_args}
if "postgresql" in DATABASE_URL or DATABASE_URL.startswith("postgres"):
    engine_kwargs["pool_pre_ping"] = True
    engine_kwargs["pool_recycle"] = 300

engine = create_engine(DATABASE_URL, **engine_kwargs)

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
    try:
        Base.metadata.create_all(bind=engine)
        print(f"Tables created at: {DATABASE_URL}")
        
        # Run automatic ALTER TABLE check only if the summary column doesn't exist yet.
        # Checking column existence first avoids blocking table locks in PostgreSQL.
        from sqlalchemy import inspect, text
        try:
            inspector = inspect(engine)
            columns = [col["name"] for col in inspector.get_columns("pages")]
            if "summary" not in columns:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE pages ADD COLUMN summary TEXT NULL;"))
                    print("Successfully added 'summary' column to 'pages' table.")
            else:
                print("Database schema check: 'summary' column already exists.")
        except Exception as e:
            print(f"Schema update check completed with warning: {e}")
    except Exception as e:
        print(f"WARNING: Database initialization encountered an error: {e}")


if __name__ == "__main__":
    init_db()