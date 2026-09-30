import os
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.vectorstores import Chroma
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain.prompts import PromptTemplate
from langchain.chains import create_retrieval_chain
from langchain.chains.combine_documents import create_stuff_documents_chain
from rag_engine.config import CHROMA_DB_DIR, EMBEDDING_MODEL

# Singleton variables
_vector_store = None
_retriever = None
_embeddings = None

def get_vector_store():
    global _vector_store, _embeddings, _retriever
    if _vector_store is None:
        if not os.path.exists(CHROMA_DB_DIR):
            return None
        
        _embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL)
        _vector_store = Chroma(persist_directory=CHROMA_DB_DIR, embedding_function=_embeddings)
        _retriever = _vector_store.as_retriever(search_kwargs={"k": 4})
        
    return _vector_store, _retriever

def get_llm():
    # Attempt to load LLM API key
    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        return None
    try:
        # We can use gemini-1.5-flash for fast responses
        llm = ChatGoogleGenerativeAI(model="gemini-1.5-flash", temperature=0.2)
        return llm
    except Exception as e:
        print(f"Failed to initialize LLM: {e}")
        return None

def answer_query(query: str):
    """
    Given a query, retrieves relevant chunks and optionally generates an answer.
    """
    store_and_retriever = get_vector_store()
    if not store_and_retriever:
        return {
            "answer": "RAG database not found. Please run the ingestion script first.",
            "sources": [],
            "used_llm": False
        }
        
    _, retriever = store_and_retriever
    
    # Retrieve documents
    retrieved_docs = retriever.invoke(query)
    sources = [{"source": doc.metadata.get("source", "Unknown"), "content": doc.page_content} for doc in retrieved_docs]
    
    if not retrieved_docs:
         return {
            "answer": "No relevant compliance regulations found in the database for this query.",
            "sources": [],
            "used_llm": False
        }
        
    llm = get_llm()
    
    if not llm:
        # Fallback if no API key is provided: Just return the top retrieved clauses
        combined_text = "\n\n".join([f"Clause from {s['source']}:\n{s['content']}" for s in sources])
        fallback_answer = (
            "NOTE: No GOOGLE_API_KEY found, returning raw retrieved clauses instead of an LLM generated answer.\n\n"
            f"Here are the most relevant rules found:\n\n{combined_text}"
        )
        return {
            "answer": fallback_answer,
            "sources": sources,
            "used_llm": False
        }
    
    # If LLM is available, build the full generation chain
    system_prompt = (
        "You are AgriBridge AI, a specialized agricultural compliance expert. "
        "Use the following pieces of retrieved regulatory context to answer the user's question. "
        "If the answer is not contained in the context, say 'Based on the provided compliance documents, I do not have enough information to answer this.' "
        "Do not hallucinate or provide legal advice outside of the provided context. "
        "Keep your answer clear, concise, and structured.\n\n"
        "Context:\n{context}"
    )
    
    prompt = PromptTemplate(
        template=system_prompt + "\n\nQuestion: {input}\nAnswer:",
        input_variables=["context", "input"]
    )
    
    combine_docs_chain = create_stuff_documents_chain(llm, prompt)
    retrieval_chain = create_retrieval_chain(retriever, combine_docs_chain)
    
    response = retrieval_chain.invoke({"input": query})
    
    return {
        "answer": response["answer"],
        "sources": sources,
        "used_llm": True
    }
