import os
import glob
from langchain_community.document_loaders import PyPDFLoader, TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.vectorstores import Chroma
from rag_engine.config import DOCUMENTS_DIR, CHROMA_DB_DIR, CHUNK_SIZE, CHUNK_OVERLAP, EMBEDDING_MODEL

def load_documents(docs_dir):
    documents = []
    
    # Load Text files
    txt_files = glob.glob(os.path.join(docs_dir, "**/*.txt"), recursive=True)
    for file in txt_files:
        try:
            loader = TextLoader(file, encoding="utf-8")
            documents.extend(loader.load())
        except Exception as e:
            print(f"Error loading {file}: {e}")
            
    # Load PDF files
    pdf_files = glob.glob(os.path.join(docs_dir, "**/*.pdf"), recursive=True)
    for file in pdf_files:
        try:
            loader = PyPDFLoader(file)
            documents.extend(loader.load())
        except Exception as e:
            print(f"Error loading {file}: {e}")
            
    return documents

def main():
    print(f"Loading documents from {DOCUMENTS_DIR}...")
    if not os.path.exists(DOCUMENTS_DIR):
        os.makedirs(DOCUMENTS_DIR, exist_ok=True)
        print(f"Created {DOCUMENTS_DIR}. Please add some documents and run again.")
        return
        
    documents = load_documents(DOCUMENTS_DIR)
    if not documents:
        print("No documents found. Please add .txt or .pdf files to the documents directory.")
        return
        
    print(f"Loaded {len(documents)} document pages/files.")
    
    # Chunking
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        separators=["\n\n", "\n", " ", ""]
    )
    chunks = text_splitter.split_documents(documents)
    print(f"Created {len(chunks)} text chunks.")
    
    # Embeddings
    print(f"Initializing embedding model '{EMBEDDING_MODEL}'...")
    embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL)
    
    # Create / Update ChromaDB
    print(f"Storing embeddings in ChromaDB at {CHROMA_DB_DIR}...")
    vector_store = Chroma.from_documents(
        documents=chunks,
        embedding=embeddings,
        persist_directory=CHROMA_DB_DIR
    )
    
    print("Ingestion complete. The database is ready for queries.")

if __name__ == "__main__":
    main()
