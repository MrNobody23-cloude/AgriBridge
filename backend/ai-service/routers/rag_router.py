"""RAG Compliance Intelligence Router."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

if TYPE_CHECKING:
    from rag.pipeline import RAGPipeline

router = APIRouter()


class ComplianceRequest(BaseModel):
    country: str = Field(..., description="Destination country for export")
    crop: str | None = "General Agriculture"
    batchId: str | None = None
    shipmentId: str | None = None
    context: dict[str, Any] | None = None


class ConsumerQueryRequest(BaseModel):
    batchCode: str
    query: str = Field(..., max_length=500)
    batchContext: dict[str, Any] | None = None


class AddDocumentRequest(BaseModel):
    title: str
    source: str
    jurisdiction: str
    documentType: str
    content: str
    publicationDate: str | None = None
    url: str | None = None


@router.post("/compliance/check")
async def check_compliance(req: ComplianceRequest, request: Request):
    rag: RAGPipeline = request.app.state.rag_pipeline

    query = (
        f"What are the export requirements, phytosanitary regulations, and compliance "
        f"standards for exporting {req.crop} from India to {req.country}? "
        f"Include MRL limits, certificate requirements, cold chain standards, and import permits."
    )

    context = req.context or {}
    if req.batchId:
        context["batchId"] = req.batchId
    if req.shipmentId:
        context["shipmentId"] = req.shipmentId
    context["country"] = req.country
    context["crop"] = req.crop

    result = await rag.answer(query, context)
    return {"success": True, "country": req.country, "crop": req.crop, **result}


@router.post("/consumer/answer")
async def consumer_answer(req: ConsumerQueryRequest, request: Request):
    rag: RAGPipeline = request.app.state.rag_pipeline

    # Combine user query with batch data for grounded answer
    query = req.query
    context = req.batchContext or {}
    context["batchCode"] = req.batchCode

    result = await rag.answer(query, context)
    return {"success": True, "batchCode": req.batchCode, **result}


@router.post("/documents/add")
async def add_document(req: AddDocumentRequest, request: Request):
    """Reject unverified manual text; knowledge is built from platform feeds."""
    raise HTTPException(
        status_code=410,
        detail="Manual text ingestion is disabled. Knowledge records must come from validated AgriBridge feeds.",
    )


@router.get("/documents/count")
async def document_count(request: Request):
    rag: RAGPipeline = request.app.state.rag_pipeline
    return {
        "success": True,
        "totalChunks": len(rag.documents) if rag.documents else 0,
        "indexReady": rag._initialized,
        "llmAvailable": rag.llm is not None,
    }


@router.post("/search")
async def search_knowledge_base(request: Request):
    body = await request.json()
    query = body.get("query", "")
    top_k = int(body.get("top_k", 5))

    if not query:
        raise HTTPException(status_code=400, detail="query is required")

    rag: RAGPipeline = request.app.state.rag_pipeline
    results = rag.retrieve(query, top_k=top_k)
    return {"success": True, "query": query, "results": results, "count": len(results)}
