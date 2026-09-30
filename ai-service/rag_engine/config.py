import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROMA_DB_DIR = os.path.join(BASE_DIR, "chroma_db")
DOCUMENTS_DIR = os.path.join(BASE_DIR, "documents")

# Chunking settings
CHUNK_SIZE = 1000
CHUNK_OVERLAP = 200

# Embedding model (using a lightweight sentence-transformer model suitable for CPU)
EMBEDDING_MODEL = "all-MiniLM-L6-v2"
