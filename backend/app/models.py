from datetime import datetime
from sqlalchemy import Column, Integer, BigInteger, String, Float, DateTime, Boolean, ForeignKey
from sqlalchemy.orm import declarative_base, relationship

# Create the declarative base class which our models will inherit from
Base = declarative_base()

class Page(Base):
    """
    Represents a Wikipedia page (article) that we are tracking.
    """
    __tablename__ = "pages"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, unique=True, index=True, nullable=False)
    wiki = Column(String, nullable=False)
    anomaly_score = Column(Float, index=True, nullable=True)
    cluster_id = Column(Integer, default=-1, nullable=True)
    x = Column(Float, default=0.0, nullable=True)
    y = Column(Float, default=0.0, nullable=True)
    last_checked = Column(DateTime(timezone=True), nullable=True)
    summary = Column(String, nullable=True)
    conflict_type = Column(String, nullable=True)
    conflict_type_confidence = Column(Float, nullable=True)

    # Establish a one-to-many relationship from Page to Revision
    revisions = relationship("Revision", back_populates="page", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<Page(id={self.id}, title='{self.title}', wiki='{self.wiki}')>"


class Revision(Base):
    """
    Represents an individual revision (edit) made to a Wikipedia page.
    """
    __tablename__ = "revisions"

    id = Column(Integer, primary_key=True, index=True)
    revision_id = Column(BigInteger, unique=True, index=True, nullable=False)
    page_id = Column(Integer, ForeignKey("pages.id"), index=True, nullable=False)
    editor = Column(String, nullable=False)
    timestamp = Column(DateTime(timezone=True), index=True, nullable=False)
    byte_change = Column(Integer, nullable=False)
    comment = Column(String, nullable=False)
    is_revert = Column(Boolean, default=False, nullable=False)
    is_bot = Column(Boolean, default=False, nullable=False)

    # Establish the relationship back to the Page model
    page = relationship("Page", back_populates="revisions")

    def __repr__(self) -> str:
        return f"<Revision(id={self.id}, revision_id={self.revision_id}, page_id={self.page_id}, editor='{self.editor}')>"
