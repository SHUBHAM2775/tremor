import numpy as np
from sqlalchemy.orm import Session
from app.db import SessionLocal
from app.models import Page
from app.ml.embeddings import prepare_text_for_page, generate_embeddings

def perform_clustering(db: Session):
    """
    Retrieves tracked pages, generates sentence embeddings, 
    applies UMAP dimensionality reduction to 2D, runs HDBSCAN clustering,
    and updates Page cluster_id, x, and y coordinates in the database.
    """
    import umap
    import hdbscan
    # 1. Fetch all pages with edits
    pages = db.query(Page).all()
    n_pages = len(pages)
    
    if n_pages < 3:
        print(f"Not enough pages for clustering ({n_pages} found, need at least 3).")
        return
        
    print(f"Starting clustering pipeline for {n_pages} pages...")

    # Load required data into memory to allow calculations without active db lookups
    page_ids = [page.id for page in pages]
    page_titles = [page.title for page in pages]
    
    # Prepare text blocks (which will query database revisions)
    texts = [prepare_text_for_page(page, db) for page in pages]
    
    # Close the idle connection during embedding generation and UMAP calculations
    db.close()

    # 2. Generate sentence embeddings
    embeddings = generate_embeddings(texts)
    print(f"Generated embeddings matrix with shape: {embeddings.shape}")

    # 3. Dimensionality reduction using UMAP
    n_neighbors = min(15, max(2, n_pages - 1))
    
    print(f"Reducing dimensions to 2D using UMAP (n_neighbors={n_neighbors})...")
    # Set random_state for reproducible layout coordinates
    reducer = umap.UMAP(
        n_neighbors=n_neighbors, 
        n_components=2, 
        metric="cosine", 
        random_state=42
    )
    coords = reducer.fit_transform(embeddings)

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
