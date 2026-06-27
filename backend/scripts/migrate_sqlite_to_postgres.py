import os
import sys
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

# Set sys.path to backend root directory so we can import from app.*
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.models import Base, Page, Revision

def migrate_data():
    load_dotenv()
    
    sqlite_url = "sqlite:///dev.db"
    postgres_url = os.getenv("DATABASE_URL")
    
    if not postgres_url:
        print("ERROR: DATABASE_URL environment variable is not set in .env")
        sys.exit(1)
        
    if postgres_url.startswith("postgres://"):
        postgres_url = postgres_url.replace("postgres://", "postgresql://", 1)
        
    if "sqlite" in postgres_url:
        print("ERROR: DATABASE_URL points to a SQLite database. Destination must be PostgreSQL.")
        sys.exit(1)
        
    print(f"Connecting to Source (SQLite): {sqlite_url}")
    sqlite_engine = create_engine(sqlite_url)
    SQLiteSession = sessionmaker(bind=sqlite_engine)
    sqlite_session = SQLiteSession()
    
    print(f"Connecting to Destination (Postgres): {postgres_url}")
    postgres_engine = create_engine(postgres_url)
    PostgresSession = sessionmaker(bind=postgres_engine)
    postgres_session = PostgresSession()
    
    try:
        # Get source counts
        sqlite_pages_count = sqlite_session.query(Page).count()
        sqlite_revisions_count = sqlite_session.query(Revision).count()
        print(f"Source database contains {sqlite_pages_count} pages and {sqlite_revisions_count} revisions.")
        
        if sqlite_pages_count == 0:
            print("WARNING: Source database has no pages. Nothing to migrate.")
            return

        print("Clearing destination tables (revisions first, then pages)...")
        postgres_session.query(Revision).delete()
        postgres_session.query(Page).delete()
        postgres_session.commit()
        
        print("Migrating pages...")
        pages = sqlite_session.query(Page).all()
        for page in pages:
            new_page = Page(
                id=page.id,
                title=page.title,
                wiki=page.wiki,
                anomaly_score=page.anomaly_score,
                cluster_id=page.cluster_id,
                x=page.x,
                y=page.y,
                last_checked=page.last_checked
            )
            postgres_session.add(new_page)
        postgres_session.commit()
        print(f"Successfully migrated {len(pages)} pages.")
        
        print("Migrating revisions in batches of 1000...")
        revisions = sqlite_session.query(Revision).all()
        for i, rev in enumerate(revisions):
            new_rev = Revision(
                id=rev.id,
                revision_id=rev.revision_id,
                page_id=rev.page_id,
                editor=rev.editor,
                timestamp=rev.timestamp,
                byte_change=rev.byte_change,
                comment=rev.comment,
                is_revert=rev.is_revert,
                is_bot=rev.is_bot
            )
            postgres_session.add(new_rev)
            if (i + 1) % 1000 == 0:
                postgres_session.commit()
                print(f"Migrated {i + 1} / {len(revisions)} revisions...")
        postgres_session.commit()
        print(f"Successfully migrated {len(revisions)} revisions.")
        
        # Reset the primary key sequence generators in PostgreSQL
        if postgres_engine.dialect.name == "postgresql":
            print("Resetting PostgreSQL primary key sequence counters...")
            postgres_session.execute(text("SELECT setval(pg_get_serial_sequence('pages', 'id'), coalesce(max(id), 1), max(id) IS NOT null) FROM pages;"))
            postgres_session.execute(text("SELECT setval(pg_get_serial_sequence('revisions', 'id'), coalesce(max(id), 1), max(id) IS NOT null) FROM revisions;"))
            postgres_session.commit()
            print("PostgreSQL sequences reset successfully.")
            
        # Verify counts
        dest_pages_count = postgres_session.query(Page).count()
        dest_revisions_count = postgres_session.query(Revision).count()
        
        print("\n--- MIGRATION VERIFICATION ---")
        print(f"Pages: SQLite={sqlite_pages_count} | Postgres={dest_pages_count}")
        print(f"Revisions: SQLite={sqlite_revisions_count} | Postgres={dest_revisions_count}")
        
        if sqlite_pages_count == dest_pages_count and sqlite_revisions_count == dest_revisions_count:
            print("\nSUCCESS: All data migrated and row counts match exactly!")
        else:
            print("\nERROR: Row counts do NOT match!")
            sys.exit(1)
            
    except Exception as e:
        print(f"ERROR: Migration failed due to an exception: {e!r}")
        postgres_session.rollback()
        sys.exit(1)
    finally:
        sqlite_session.close()
        postgres_session.close()

if __name__ == "__main__":
    migrate_data()
