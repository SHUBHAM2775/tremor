import umap
import hdbscan
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
    # 1. Fetch all pages with edits
    pages = db.query(Page).all()
    n_pages = len(pages)
    
    if n_pages < 3:
        print(f"Not enough pages for clustering ({n_pages} found, need at least 3).")
        return
        
    print(f"Starting clustering pipeline for {n_pages} pages...")

    # 2. Prepare text blocks for embedding
    texts = [prepare_text_for_page(page, db) for page in pages]
    
    # 3. Generate sentence embeddings
    embeddings = generate_embeddings(texts)
    print(f"Generated embeddings matrix with shape: {embeddings.shape}")

    # 4. Dimensionality reduction using UMAP
    # Adjust n_neighbors if there are very few pages to avoid UMAP errors
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

    # 5. Density-based clustering using HDBSCAN
    # Adjust min_cluster_size dynamically based on dataset size
    min_cluster_size = max(2, min(5, n_pages // 3))
    min_samples = 1 # Lower value makes it less restrictive
    
    print(f"Clustering with HDBSCAN (min_cluster_size={min_cluster_size})...")
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=min_cluster_size, 
        min_samples=min_samples, 
        metric="euclidean"
    )
    cluster_labels = clusterer.fit_predict(coords)

    # 6. Post-processing: Recenter and normalize coordinates
    if n_pages >= 3:
        centroid_x = float(np.mean(coords[:, 0]))
        centroid_y = float(np.mean(coords[:, 1]))
        coords[:, 0] -= centroid_x
        coords[:, 1] -= centroid_y
        
        max_abs = float(np.max(np.abs(coords)))
        if max_abs > 0:
            coords /= max_abs

    # 7. Save results to the database
    print("Saving cluster labels and 2D coordinates to database...")
    for i, page in enumerate(pages):
        page.x = float(coords[i, 0])  # type: ignore
        page.y = float(coords[i, 1])  # type: ignore
        page.cluster_id = int(cluster_labels[i])  # type: ignore
        db.add(page)
        
    db.commit()
    
    # Summary printing
    unique_clusters = set(cluster_labels)
    n_clusters = len(unique_clusters - {-1})
    n_noise = list(cluster_labels).count(-1)
    print(f"Clustering complete. Found {n_clusters} clusters. Noise points (unclustered): {n_noise}/{n_pages}")
    
    # Print cluster members for inspection safely
    for cid in sorted(unique_clusters):
        cluster_pages = [str(pages[j].title) for j in range(n_pages) if cluster_labels[j] == cid]
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
