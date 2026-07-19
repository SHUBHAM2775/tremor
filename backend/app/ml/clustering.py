import gc
import numpy as np
from sqlalchemy.orm import Session
from app.db import SessionLocal
from app.models import Page, Revision
from app.ml.embeddings import generate_embeddings

def perform_clustering(db: Session):
    """
    Retrieves top tracked pages by anomaly_score, generates sentence embeddings, 
    applies UMAP dimensionality reduction to 2D, runs HDBSCAN clustering,
    and updates Page cluster_id, x, and y coordinates in the database.
    """
    import umap
    import hdbscan
    # 1. Fetch top pages by anomaly score (capped at top 200)
    pages = db.query(Page).order_by(Page.anomaly_score.desc().nullslast()).limit(200).all()
    n_pages = len(pages)
    
    if n_pages < 3:
        print(f"Not enough pages for clustering ({n_pages} found, need at least 3).")
        return
        
    print(f"Starting clustering pipeline for {n_pages} pages...")

    # Load required data into memory to allow calculations without active db lookups
    page_ids = [page.id for page in pages]
    page_titles = [page.title for page in pages]
    
    # Bulk fetch revision comments using a single SQL projection (avoids loading thousands of ORM objects)
    rev_rows = db.query(Revision.page_id, Revision.comment)\
                 .filter(Revision.page_id.in_(page_ids), Revision.comment.isnot(None))\
                 .order_by(Revision.timestamp.desc())\
                 .all()

    comments_by_page = {}
    for pid, comment in rev_rows:
        if comment and len(comment.strip()) > 3:
            comments_by_page.setdefault(pid, []).append(comment.strip())

    texts = []
    for page in pages:
        comments = comments_by_page.get(page.id, [])
        seen = set()
        unique_comments = [x for x in comments if not (x in seen or seen.add(x))]
        comments_str = " | ".join(unique_comments[:10])
        text = f"Title: {page.title}. Wikipedia recent edits and disputes: {comments_str}"
        texts.append(text)
    
    # Close the idle connection during embedding generation and UMAP calculations
    db.close()

    # 2. Generate sentence embeddings with batch_size=32
    embeddings = generate_embeddings(texts, batch_size=32)
    print(f"Generated embeddings matrix with shape: {embeddings.shape}")
    
    # Free raw text list from memory
    del texts
    del comments_by_page
    del rev_rows
    gc.collect()

    # 3. Dimensionality reduction using UMAP (low_memory=True)
    n_neighbors = min(15, max(2, n_pages - 1))
    
    print(f"Reducing dimensions to 2D using UMAP (n_neighbors={n_neighbors}, low_memory=True)...")
    reducer = umap.UMAP(
        n_neighbors=n_neighbors, 
        n_components=2, 
        metric="cosine", 
        low_memory=True,
        random_state=42
    )
    coords = reducer.fit_transform(embeddings)

    # Free embeddings matrix and reducer from memory
    del embeddings
    del reducer
    gc.collect()

    # 4. Density-based clustering using HDBSCAN
    min_cluster_size = max(2, min(5, n_pages // 3))
    min_samples = 1 # Lower value makes it less restrictive
    
    print(f"Clustering with HDBSCAN (min_cluster_size={min_cluster_size})...")
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=min_cluster_size, 
        min_samples=min_samples, 
        metric="euclidean"
    )
    cluster_labels = clusterer.fit_predict(coords)

    # 5. Post-processing: Recenter and normalize coordinates
    if n_pages >= 3:
        centroid_x = float(np.mean(coords[:, 0]))
        centroid_y = float(np.mean(coords[:, 1]))
        coords[:, 0] -= centroid_x
        coords[:, 1] -= centroid_y
        
        max_abs = float(np.max(np.abs(coords)))
        if max_abs > 0:
            coords /= max_abs

    # 6. Save results to the database using a fresh connection session
    print("Saving cluster labels and 2D coordinates to database...")
    new_db = SessionLocal()
    try:
        for i, pid in enumerate(page_ids):
            page = new_db.query(Page).filter_by(id=pid).first()
            if page:
                page.x = float(coords[i, 0])  # type: ignore
                page.y = float(coords[i, 1])  # type: ignore
                page.cluster_id = int(cluster_labels[i])  # type: ignore
                new_db.add(page)
        new_db.commit()
    except Exception as e:
        new_db.rollback()
        raise e
    finally:
        new_db.close()
    
    # Summary printing
    unique_clusters = set(cluster_labels)
    n_clusters = len(unique_clusters - {-1})
    n_noise = list(cluster_labels).count(-1)
    print(f"Clustering complete. Found {n_clusters} clusters. Noise points (unclustered): {n_noise}/{n_pages}")
    
    # Print cluster members for inspection safely
    for cid in sorted(unique_clusters):
        cluster_pages = [str(page_titles[j]) for j in range(n_pages) if cluster_labels[j] == cid]
        cluster_name = f"Cluster {cid}" if cid != -1 else "Noise / Unclustered"
        try:
            print(f" - {cluster_name} ({len(cluster_pages)} pages): {', '.join(cluster_pages)}")
        except UnicodeEncodeError:
            line = f" - {cluster_name} ({len(cluster_pages)} pages): {', '.join(cluster_pages)}"
            print(line.encode("ascii", "replace").decode("ascii"))


if __name__ == "__main__":
    session = SessionLocal()
    try:
        perform_clustering(session)
    finally:
        session.close()
