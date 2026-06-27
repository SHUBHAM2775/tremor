def is_revert_edit(comment: str, tags: list = None) -> bool:
    """
    Detects if an edit is a revert based on comment heuristics and Wikimedia tags.
    """
    if tags:
        # Common revert tags on Wikimedia
        revert_tags = {"mw-revert", "mw-rollback", "mw-undo"}
        if any(t.lower() in revert_tags for t in tags):
            return True
            
    if not comment:
        return False
        
    comment_lower = comment.lower()
    revert_keywords = ["revert", "undid edit", "rv ", "rvv", "restored revision", "rollback"]
    return any(kw in comment_lower for kw in revert_keywords)
