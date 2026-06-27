import os
from sqlalchemy.orm import Session
from app.models import Page, Revision

def generate_dispute_summary(page: Page, revisions: list[Revision]) -> str:
    """
    Generates a 2-3 sentence plain-English summary of the edit dispute on a page.
    Attempts to use Gemini or Groq if API keys are available, and falls back
    to a detailed heuristic-based text summary otherwise.
    """
    if not revisions:
        return "No recent edit history available to summarize."

    # Extract edit comments, authors, and revert details
    comments = [r.comment.strip() for r in revisions if r.comment and len(r.comment.strip()) > 3]
    editors = list(set([r.editor for r in revisions if r.editor]))
    revert_count = sum(1 for r in revisions if r.is_revert)
    bot_count = sum(1 for r in revisions if r.is_bot)
    
    unique_comments = list(set(comments))[:15]
    comments_block = "\n".join([f"- {c}" for c in unique_comments])
    editors_str = ", ".join(editors[:5])

    # Check for API keys
    gemini_key = os.getenv("GEMINI_API_KEY")
    groq_key = os.getenv("GROQ_API_KEY")

    prompt = (
        f"You are an expert Wikipedia edit war analyst. Below is a list of recent edit comments and metadata "
        f"from a disputed page titled '{page.title}' on Wikipedia.\n\n"
        f"Page: {page.title}\n"
        f"Total Edits in Sample: {len(revisions)}\n"
        f"Total Reverts: {revert_count}\n"
        f"Active Editors: {editors_str}\n"
        f"Recent Edit Comments:\n{comments_block}\n\n"
        f"Provide a brief, objective, 2 to 3 sentence explanation in plain English summarizing what the editors "
        f"are currently disputing (e.g. key topics of disagreement, policy disputes, or content changes). "
        f"Do not mention formatting tags, raw database fields, or HTML. Keep it clean and readable."
    )

    # 1. Try Gemini
    if gemini_key:
        try:
            print("Using Gemini API for summary generation...")
            from google import genai
            client = genai.Client(api_key=gemini_key)
            response = client.models.generate_content(
                model='gemini-2.5-flash',
                contents=prompt,
            )
            return response.text.strip()
        except Exception as e:
            print(f"Gemini API failed: {e}. Falling back...")

    # 2. Try Groq
    if groq_key:
        try:
            print("Using Groq API for summary generation...")
            from groq import Groq
            client = Groq(api_key=groq_key)
            completion = client.chat.completions.create(
                model="llama3-8b-8192",
                messages=[
                    {"role": "system", "content": "You are a concise Wikipedia dispute analyst."},
                    {"role": "user", "content": prompt}
                ],
                max_tokens=150,
                temperature=0.3
            )
            return completion.choices[0].message.content.strip()
        except Exception as e:
            print(f"Groq API failed: {e}. Falling back...")

    # 3. Fallback Heuristic Summary
    print("No LLM API keys configured or calls failed. Generating rule-based summary fallback...")
    
    # Analyze comments for key terms
    topics = []
    keywords = ["revert", "undid", "vandalism", "source", "cite", "reference", "neutral", "pov", "bias", "deleted", "added"]
    for comment in comments:
        comment_lower = comment.lower()
        for kw in keywords:
            if kw in comment_lower and kw not in topics:
                topics.append(kw)

    topics_str = ""
    if topics:
        topics_str = f" Disagreements are emerging around topics related to: {', '.join(topics[:4])}."

    summary = (
        f"The Wikipedia article '{page.title}' is experiencing active editing conflict, "
        f"with {len(revisions)} recent edits and {revert_count} revert(s) logged by {len(editors)} unique editors "
        f"(including {bot_count} bot actions).{topics_str} "
        f"Major contributors currently involved include: {editors_str}."
    )
    return summary
