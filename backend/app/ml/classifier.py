import os
from typing import List, Tuple
import torch

MODEL_NAME = "Shubham2775/tremor-conflict-classifier"
LABELS = [
    "Political/Ideological",
    "Factual/Sourcing",
    "Conduct/Personal",
    "Notability/Inclusion",
    "Vandalism/Bad-faith",
]

_tokenizer = None
_model = None

def get_classifier():
    """
    Lazy loader for Hugging Face tokenizer and SequenceClassification model
    to avoid loading heavy transformers model on module import.
    """
    global _tokenizer, _model
    if _tokenizer is None or _model is None:
        from transformers import AutoTokenizer, AutoModelForSequenceClassification
        print(f"Loading conflict classification model: {MODEL_NAME}...")
        token = os.environ.get("HF_TOKEN")
        _tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME, token=token)
        _model = AutoModelForSequenceClassification.from_pretrained(MODEL_NAME, token=token)
        _model.eval()
    return _tokenizer, _model

def classify_batch(texts: List[str], batch_size: int = 32) -> List[Tuple[str, float]]:
    """
    Classifies a list of texts into conflict types.
    Returns a list of (label, confidence) tuples matching the input order.
    """
    if not texts:
        return []

    tokenizer, model = get_classifier()
    results: List[Tuple[str, float]] = []

    for i in range(0, len(texts), batch_size):
        batch_texts = texts[i : i + batch_size]
        inputs = tokenizer(
            batch_texts,
            padding=True,
            truncation=True,
            max_length=512,
            return_tensors="pt",
        )
        with torch.no_grad():
            outputs = model(**inputs)
            logits = outputs.logits
            probs = torch.softmax(logits, dim=-1)
            confidences, label_indices = torch.max(probs, dim=-1)

        for idx, conf in zip(label_indices.tolist(), confidences.tolist()):
            label = LABELS[idx]
            results.append((label, float(conf)))

    return results
