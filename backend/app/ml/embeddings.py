from typing import cast
import numpy as np
from sqlalchemy.orm import Session
from app.models import Page, Revision

# Use the recommended lightweight and fast model
MODEL_NAME = "all-MiniLM-L6-v2"
model = None

def get_model():
    """
    Lazy loader for SentenceTransformer to avoid loading it on module import.
    """
    global model
    if model is None:
        from sentence_transformers import SentenceTransformer
        print(f"Loading sentence-transformer model: {MODEL_NAME}...")
        model = SentenceTransformer(MODEL_NAME)
    return model

def prepare_text_for_page(page: Page, db: Session) -> str:
    """
    Prepares a descriptive text block for a page by combining its title
    with its edit summaries (comments), prioritizing revert comments.
    """
    # Fetch recent revisions
    revisions = db.query(Revision).filter_by(page_id=page.id).order_by(Revision.timestamp.desc()).limit(30).all()
    
    # Extract comments
    comments = []
    for rev in revisions:
        if rev.comment and len(rev.comment.strip()) > 3:
            comments.append(rev.comment.strip())
            
    # Remove duplicates but preserve order
    seen = set()
    unique_comments = [x for x in comments if not (x in seen or seen.add(x))]
    
    # Combine title and comments
    comments_str = " | ".join(unique_comments[:10]) # Limit to top 10 unique comments to keep text size reasonable
    text = f"Title: {page.title}. Wikipedia recent edits and disputes: {comments_str}"
    return text

def generate_embeddings(texts: list[str]) -> np.ndarray:
    """
    Generates sentence embeddings for a list of texts.
    """
    if not texts:
        return np.empty((0, 384)) # all-MiniLM-L6-v2 outputs 384-dimensional embeddings
        
    s_model = get_model()
    embeddings = s_model.encode(texts, show_progress_bar=True)
    return cast(np.ndarray, embeddings)
