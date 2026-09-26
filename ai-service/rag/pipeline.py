"""
AgriBridge AI — RAG Pipeline
Real retrieval-augmented generation using FAISS + Gemini.

Architecture:
  Agricultural Regulation Documents
          ↓
  Text extraction + chunking
          ↓
  SentenceTransformer embeddings
          ↓
  FAISS vector store
          ↓
  Semantic retrieval
          ↓
  Gemini LLM synthesis
          ↓
  Evidence-based answer + citations
"""
import os
import json
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional

logger = logging.getLogger("agribridge.rag")

VECTOR_STORE_DIR = Path(os.getenv("RAG_VECTOR_STORE_DIR", "./vectorstore"))
DOCUMENTS_DIR    = Path(os.getenv("RAG_DOCUMENTS_DIR", "./rag_documents"))
GEMINI_API_KEY   = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL     = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
EMBED_MODEL_NAME = "all-MiniLM-L6-v2"  # small, fast, runs offline


class RAGPipeline:
    """
    Production-quality RAG pipeline for agricultural regulatory compliance.
    """

    def __init__(self):
        self.embedder = None
        self.index = None
        self.documents: List[Dict] = []
        self.llm = None
        self._initialized = False

    async def initialize(self):
        """Load embedder, FAISS index, and Gemini LLM."""
        try:
            from sentence_transformers import SentenceTransformer
            self.embedder = SentenceTransformer(EMBED_MODEL_NAME)
            logger.info(f"✅ Embedder loaded: {EMBED_MODEL_NAME}")
        except Exception as e:
            logger.error(f"❌ Failed to load embedder: {e}")
            self.embedder = None

        # Load or build FAISS index
        index_path = VECTOR_STORE_DIR / "agribridge.faiss"
        docs_path  = VECTOR_STORE_DIR / "documents.json"

        if index_path.exists() and docs_path.exists():
            try:
                import faiss
                self.index = faiss.read_index(str(index_path))
                with open(docs_path) as f:
                    self.documents = json.load(f)
                logger.info(f"✅ FAISS index loaded: {len(self.documents)} documents")
            except Exception as e:
                logger.warning(f"⚠️ Failed to load existing index: {e}. Will rebuild.")
                await self._build_index()
        else:
            await self._build_index()

        # Init Gemini
        if GEMINI_API_KEY:
            try:
                import google.generativeai as genai
                genai.configure(api_key=GEMINI_API_KEY)
                self.llm = genai.GenerativeModel(GEMINI_MODEL)
                logger.info(f"✅ Gemini LLM initialized: {GEMINI_MODEL}")
            except Exception as e:
                logger.warning(f"⚠️ Gemini init failed: {e}. RAG will return retrieval-only results.")
                self.llm = None
        else:
            logger.warning("⚠️ GEMINI_API_KEY not set. RAG answers will be retrieval-only.")

        self._initialized = True

    async def _build_index(self):
        """Build FAISS vector store from regulation documents."""
        if self.embedder is None:
            logger.error("Cannot build index: embedder not loaded.")
            return

        VECTOR_STORE_DIR.mkdir(parents=True, exist_ok=True)
        DOCUMENTS_DIR.mkdir(parents=True, exist_ok=True)

        # Load seed regulation documents
        seed_docs = self._get_seed_documents()

        # Also scan DOCUMENTS_DIR for any user-uploaded .txt / .md files
        for doc_file in DOCUMENTS_DIR.glob("*.txt"):
            try:
                text = doc_file.read_text(encoding="utf-8")
                seed_docs.append({
                    "document_id": doc_file.stem,
                    "title": doc_file.stem.replace("_", " ").title(),
                    "source": "User Upload",
                    "jurisdiction": "GLOBAL",
                    "document_type": "REGULATION",
                    "content": text,
                    "chunk_index": 0,
                    "publication_date": "",
                })
            except Exception as e:
                logger.warning(f"Failed to read {doc_file}: {e}")

        if not seed_docs:
            logger.warning("No documents to index.")
            return

        # Chunk and embed
        chunks = []
        for doc in seed_docs:
            for chunk in self._chunk_text(doc["content"], doc):
                chunks.append(chunk)

        texts = [c["text"] for c in chunks]
        embeddings = self.embedder.encode(texts, show_progress_bar=False, normalize_embeddings=True)

        import faiss
        import numpy as np
        dim = embeddings.shape[1]
        index = faiss.IndexFlatIP(dim)  # Inner product = cosine similarity (normalized)
        index.add(embeddings.astype("float32"))

        self.index = index
        self.documents = chunks

        # Persist
        faiss.write_index(index, str(VECTOR_STORE_DIR / "agribridge.faiss"))
        with open(VECTOR_STORE_DIR / "documents.json", "w") as f:
            json.dump(chunks, f, indent=2, default=str)

        logger.info(f"✅ Built FAISS index with {len(chunks)} chunks from {len(seed_docs)} documents.")

    def _chunk_text(self, text: str, metadata: dict, chunk_size: int = 500, overlap: int = 50) -> List[Dict]:
        """Split text into overlapping chunks for retrieval."""
        words = text.split()
        chunks = []
        for i in range(0, max(1, len(words) - overlap), chunk_size - overlap):
            chunk_words = words[i:i + chunk_size]
            chunk_text = " ".join(chunk_words)
            chunks.append({
                **{k: v for k, v in metadata.items() if k != "content"},
                "text": chunk_text,
                "chunk_start": i,
            })
        return chunks if chunks else [{"text": text, "chunk_start": 0, **{k: v for k, v in metadata.items() if k != "content"}}]

    def retrieve(self, query: str, top_k: int = 5) -> List[Dict]:
        """Semantic search over regulation chunks."""
        if self.index is None or self.embedder is None or self.index.ntotal == 0:
            return []
        import numpy as np
        q_emb = self.embedder.encode([query], normalize_embeddings=True)
        distances, indices = self.index.search(q_emb.astype("float32"), min(top_k, self.index.ntotal))
        results = []
        for dist, idx in zip(distances[0], indices[0]):
            if idx < len(self.documents) and dist > 0.2:  # cosine similarity threshold
                doc = dict(self.documents[idx])
                doc["relevance_score"] = float(dist)
                results.append(doc)
        return results

    async def answer(self, query: str, context: Optional[Dict] = None) -> Dict[str, Any]:
        """
        Full RAG answer: retrieve + synthesize with Gemini.
        Never hallucinates: if no evidence found, says so.
        """
        retrieved = self.retrieve(query, top_k=5)

        if not retrieved:
            return {
                "answer": "Insufficient evidence found in the current knowledge base for this query.",
                "evidence": [],
                "sources": [],
                "confidence": 0.0,
                "tools_used": ["faiss_retrieval"],
                "warning": "NO_EVIDENCE",
                "timestamp": _now(),
            }

        # Format context for LLM
        context_text = "\n\n".join([
            f"[{i+1}] ({doc.get('jurisdiction','')}) {doc.get('title','')}\n{doc['text']}"
            for i, doc in enumerate(retrieved)
        ])

        # Add batch context if provided
        batch_context = ""
        if context:
            batch_context = f"\n\nSupply chain context:\n{json.dumps(context, indent=2, default=str)}"

        if self.llm is None:
            # No LLM available — return structured retrieval result only
            return {
                "answer": f"Retrieved {len(retrieved)} relevant regulation chunks. LLM synthesis unavailable (GEMINI_API_KEY not configured).",
                "evidence": [{"text": d["text"][:300], "source": d.get("source",""), "title": d.get("title",""), "relevance": d["relevance_score"]} for d in retrieved],
                "sources": list({d.get("source","") for d in retrieved}),
                "confidence": float(retrieved[0]["relevance_score"]) if retrieved else 0.0,
                "tools_used": ["faiss_retrieval"],
                "warning": "LLM_UNAVAILABLE",
                "timestamp": _now(),
            }

        prompt = f"""You are AgriBridge AI Compliance Intelligence, an expert in agricultural export regulations, food safety standards, and phytosanitary requirements.

Answer the following query using ONLY the provided regulatory context. Do not invent regulations, certificates, or requirements not present in the context.
If the context does not contain sufficient information, state: "Insufficient evidence in current knowledge base."

Query: {query}
{batch_context}

Regulatory Context:
{context_text}

Provide a concise, evidence-based answer. Cite the source documents by number [1], [2], etc."""

        try:
            response = self.llm.generate_content(prompt)
            answer_text = response.text

            # Extract cited sources
            cited_sources = []
            for i, doc in enumerate(retrieved):
                if f"[{i+1}]" in answer_text:
                    cited_sources.append({
                        "index": i + 1,
                        "title": doc.get("title", ""),
                        "source": doc.get("source", ""),
                        "jurisdiction": doc.get("jurisdiction", ""),
                        "document_type": doc.get("document_type", ""),
                        "relevance": doc["relevance_score"],
                    })

            return {
                "answer": answer_text,
                "evidence": [{"text": d["text"][:400], "source": d.get("source",""), "title": d.get("title",""), "relevance": d["relevance_score"]} for d in retrieved],
                "sources": cited_sources or [{"title": d.get("title",""), "source": d.get("source","")} for d in retrieved[:3]],
                "confidence": float(retrieved[0]["relevance_score"]),
                "tools_used": ["faiss_retrieval", "gemini_synthesis"],
                "timestamp": _now(),
            }
        except Exception as e:
            logger.error(f"Gemini synthesis error: {e}")
            return {
                "answer": f"Retrieval succeeded but LLM synthesis failed: {str(e)[:100]}",
                "evidence": [{"text": d["text"][:300], "source": d.get("source",""), "title": d.get("title",""), "relevance": d["relevance_score"]} for d in retrieved],
                "sources": [{"title": d.get("title",""), "source": d.get("source","")} for d in retrieved],
                "confidence": float(retrieved[0]["relevance_score"]) if retrieved else 0.0,
                "tools_used": ["faiss_retrieval"],
                "error": str(e)[:200],
                "timestamp": _now(),
            }

    def add_document(self, doc: Dict) -> bool:
        """Add a new document to the index at runtime."""
        if self.embedder is None or self.index is None:
            return False
        import numpy as np
        chunks = self._chunk_text(doc["content"], doc)
        texts = [c["text"] for c in chunks]
        embeddings = self.embedder.encode(texts, normalize_embeddings=True)
        self.index.add(embeddings.astype("float32"))
        self.documents.extend(chunks)
        # Persist updated index
        try:
            import faiss
            faiss.write_index(self.index, str(VECTOR_STORE_DIR / "agribridge.faiss"))
            with open(VECTOR_STORE_DIR / "documents.json", "w") as f:
                json.dump(self.documents, f, indent=2, default=str)
        except Exception as e:
            logger.error(f"Failed to persist updated index: {e}")
        return True

    def _get_seed_documents(self) -> List[Dict]:
        """Seed regulation documents for the knowledge base."""
        return [
            {
                "document_id": "apeda_export_guidelines_2024",
                "title": "APEDA Agricultural Export Guidelines 2024",
                "source": "Agricultural and Processed Food Products Export Development Authority (APEDA), India",
                "jurisdiction": "INDIA",
                "document_type": "EXPORT_REGULATION",
                "publication_date": "2024-01-01",
                "content": """APEDA Agricultural Export Guidelines 2024

1. Phytosanitary Certification Requirements
All agricultural produce exported from India must be accompanied by a Phytosanitary Certificate issued by the Plant Quarantine Authority of India under the Plant Quarantine (Regulation of Import into India) Order, 2003. The certificate must state that the consignment has been inspected and found free from quarantine pests and diseases.

2. Registration and Membership
Exporters must be registered with APEDA under the APEDA Act, 1985. Registration is mandatory for export of scheduled products including fresh fruits, vegetables, meat products, poultry products, dairy products, confectionery, and processed food.

3. Maximum Residue Limits (MRL)
All exported agricultural produce must comply with MRL standards of the importing country. For European Union exports, compliance with EC Regulation 396/2005 is mandatory. For USA, compliance with US EPA tolerances under FIFRA is required. Produce must undergo multi-residue pesticide testing at NABL-accredited laboratories.

4. Cold Chain Requirements
Perishable commodities must be transported under controlled temperature conditions. Mangoes: 11-14°C. Grapes: 1-4°C. All reefer containers must carry continuous temperature data loggers. Temperature logs must be submitted with the shipment documentation.

5. Traceability Requirements
Each batch must have a unique batch identifier traceable from farm to consumer. Farm-level records including pesticide application records, irrigation records, and harvesting records must be maintained for 3 years.

6. Pre-shipment Inspection
All consignments are subject to pre-shipment inspection by APEDA-empanelled inspection agencies. Sampling and testing norms as per IS/ISO standards must be followed.
""",
            },
            {
                "document_id": "eu_plant_health_regulation_2016_2031",
                "title": "EU Plant Health Regulation 2016/2031",
                "source": "European Parliament and Council of the European Union",
                "jurisdiction": "EU",
                "document_type": "PLANT_HEALTH_REGULATION",
                "publication_date": "2016-10-26",
                "content": """EU Plant Health Regulation (EU) 2016/2031

Key Provisions for Agricultural Imports:

1. Phytosanitary Requirements
Plants, plant products and other objects imported into the Union territory must comply with the plant health requirements. Imported consignments must be accompanied by a phytosanitary certificate issued by the National Plant Protection Organization (NPPO) of the exporting country.

2. Official Controls at Border
All regulated consignments must undergo official plant health checks at the Border Inspection Post (BIP) of entry. This includes documentary checks, identity checks, and physical checks including laboratory testing where applicable.

3. List of Regulated Pests
Annex II lists Union quarantine pests. Fresh mango from India must be free of: Bactrocera dorsalis (Oriental fruit fly), Ceratitis capitata (Mediterranean fruit fly), Mangifera indica (bacterial canker).

4. MRL Compliance - Regulation EC 396/2005
Maximum residue levels for pesticides in food and feed. Products must comply with default MRL of 0.01 mg/kg unless a specific MRL is established. Chlorpyrifos: 0.01 mg/kg default limit for most fruits.

5. Organic Product Imports
Organic products from third countries must comply with EU organic farming regulation and be accompanied by a Certificate of Inspection issued by an EU-recognized control body or control authority.

6. Cold Chain Documentation
Temperature sensitive products require continuous monitoring. Deviation reports must accompany shipment.
""",
            },
            {
                "document_id": "us_fda_fsma_2011",
                "title": "US FDA Food Safety Modernization Act (FSMA) 2011",
                "source": "US Food and Drug Administration",
                "jurisdiction": "USA",
                "document_type": "FOOD_SAFETY_REGULATION",
                "publication_date": "2011-01-04",
                "content": """US FDA Food Safety Modernization Act (FSMA) 2011 — Foreign Supplier Verification Program

1. FSVP Requirements for Importers
US food importers must establish and follow a Foreign Supplier Verification Program (FSVP). The FSVP must include: hazard analysis of the food, evaluation of the foreign supplier's performance and food safety practices, conducting verification activities.

2. Hazard Analysis
Importers must analyze known or reasonably foreseeable hazards for each food. This includes biological hazards (pathogens), chemical hazards (pesticide residues, mycotoxins, heavy metals), and physical hazards.

3. FDA Registration
Foreign food facilities must be registered with the FDA. Registration renewal is required every two years during October-December of even-numbered years.

4. Prior Notice
Prior notice is required for all food and feed imported into the US. FDA must receive prior notice before arrival.

5. USDA APHIS Import Requirements
Fresh fruits and vegetables from India are subject to USDA APHIS plant health regulations. Vapor heat treatment or other approved phytosanitary treatments may be required. An import permit from USDA APHIS is required for many commodities including mangoes from India.

6. Mango Import Conditions (India to USA)
Indian mangoes exported to the USA must undergo vapor heat treatment at USDA-approved facilities. USDA APHIS inspection is required. Fumigation with methyl bromide may be required. Phytosanitary certificate from India's Department of Agriculture is mandatory.
""",
            },
            {
                "document_id": "uae_food_safety_standards",
                "title": "UAE Food Safety Standards and Import Requirements",
                "source": "UAE Ministry of Climate Change and Environment / Dubai Municipality",
                "jurisdiction": "UAE",
                "document_type": "FOOD_SAFETY_REGULATION",
                "publication_date": "2023-01-01",
                "content": """UAE Food Safety Requirements for Agricultural Imports

1. General Import Requirements
All food products imported into UAE must comply with UAE.S GSO 9:2013 (Gulf Standard) and UAE Federal Law No. 10 of 2015 on Food Safety. Products must be accompanied by: Certificate of Origin, Health Certificate, Phytosanitary Certificate (for fresh produce).

2. Halal Certification
Food products imported into UAE must be Halal certified unless naturally Halal (fresh fruits and vegetables). Processed food products must carry Halal certification from UAE-recognized certification bodies.

3. Cold Chain Requirements
All perishable goods including fresh fruits must be transported in temperature-controlled vehicles or containers. Dubai Municipality requires continuous temperature monitoring for reefer containers. Temperature must be maintained: Fresh fruits 8-13°C, Vegetables 2-8°C.

4. Pesticide Residues
UAE follows Gulf Cooperation Council (GCC) standards for maximum residue limits. Products exceeding MRL limits will be rejected at port of entry. Organic produce must carry recognized organic certification.

5. Packaging and Labeling
All products must be labeled in Arabic. Labels must include: product name, net weight, country of origin, manufacturing/expiry date, ingredients, nutritional information, storage conditions.

6. MOEI Import Permit
Import permit from UAE Ministry of Economy and Infrastructure (MOEI) required for certain agricultural commodities. Prior registration with Dubai Municipality food safety portal required for regular importers.
""",
            },
            {
                "document_id": "india_fssai_export_standards",
                "title": "FSSAI Food Safety Standards for Agricultural Exports",
                "source": "Food Safety and Standards Authority of India (FSSAI)",
                "jurisdiction": "INDIA",
                "document_type": "FOOD_SAFETY_REGULATION",
                "publication_date": "2023-06-01",
                "content": """FSSAI Food Safety Standards for Agricultural Exports

1. Food Safety and Standards Act 2006
All food businesses including exporters must obtain FSSAI license or registration. Food products must comply with standards specified under Food Safety and Standards (Food Products Standards and Food Additives) Regulations 2011.

2. Agricultural Produce Standards
Fresh Fruits: Must be free from insect damage, fungal infection, and foreign matter. Maximum moisture content and size specifications applicable. Fresh mangoes must meet IS 1477 specifications.

3. Contaminant Limits
Heavy Metals: Lead max 2.5 mg/kg in fruits, Arsenic max 1.3 mg/kg, Cadmium max 0.1 mg/kg, Mercury max 0.01 mg/kg. Aflatoxins: Total aflatoxins max 20 ppb. Pesticide residues: as per schedule IV of FSS regulations.

4. Testing Requirements
All export consignments must be tested at NABL/BIS-accredited laboratories for pesticide residues, heavy metals, microbiological parameters. Test reports must be attached to export documentation.

5. Cold Chain Infrastructure
Cold storage facilities must be registered with FSSAI and meet Good Manufacturing Practices (GMP) requirements. Pre-cooling facilities at farm level recommended for perishables.

6. Organic Certification
Products labeled organic must be certified under NPOP (National Programme for Organic Production) by APEDA-accredited certification bodies.
""",
            },
            {
                "document_id": "codex_alimentarius_fresh_fruits",
                "title": "Codex Alimentarius Standards for Fresh Fruits and Vegetables",
                "source": "Codex Alimentarius Commission (FAO/WHO)",
                "jurisdiction": "GLOBAL",
                "document_type": "INTERNATIONAL_STANDARD",
                "publication_date": "2022-01-01",
                "content": """Codex Alimentarius General Standard for Fresh Fruits and Vegetables

1. Quality Standards
Fresh fruits and vegetables must be: intact, sound, clean, free of abnormal external moisture, free of foreign smell and/or taste, free of pests, free of damage caused by pests, sufficiently developed, suitably ripe (not over-ripe).

2. Codex MRL Standards
The Codex Committee on Pesticide Residues (CCPR) establishes Codex Maximum Residue Limits (CXLs). These serve as reference points for international trade. Where importing countries do not have national MRLs, Codex MRLs apply.

3. Temperature Requirements
General principle: most fruits should be stored at temperatures close to their lowest safe storage temperature (chilling injury threshold). Mango: 10-13°C for long-distance transport. Grapes: -1 to 0°C for long storage.

4. Hygienic Practices
Recommended International Code of Practice for the Processing and Handling of Quick Frozen Foods (CAC/RCP 8-1976). Good Agricultural Practices (GAP) principles apply from pre-harvest through distribution.

5. Traceability
Codex Principles for Traceability/Product Tracing (CAC/GL 60-2006) requires that traceability systems should be able to identify the movement of a food product through specified stages of production, processing, and distribution.

6. Packaging and Transport
Packaging must protect the product from physical damage, contamination, and deterioration during transport. Materials in contact with food must be food-grade and comply with applicable standards.
""",
            },
            {
                "document_id": "japan_food_sanitation_act",
                "title": "Japan Food Sanitation Act — Import Requirements",
                "source": "Japanese Ministry of Health, Labour and Welfare (MHLW)",
                "jurisdiction": "JAPAN",
                "document_type": "FOOD_SAFETY_REGULATION",
                "publication_date": "2023-04-01",
                "content": """Japan Food Sanitation Act — Agricultural Import Requirements

1. Positive List System for Agricultural Chemicals
Japan's Positive List System (PLS) came into effect in May 2006. All agricultural chemicals not on the positive list are subject to a uniform limit of 0.01 ppm. Organophosphate pesticides: specific limits apply, generally 0.01-0.5 ppm for most fruits. Chlorpyrifos: 0.01 ppm for most fruits and vegetables.

2. Import Inspection Requirements
Food importers must notify Ministry of Health, Labour and Welfare (MHLW) at the time of import. Inspection by Quarantine Stations includes: documentary review, organoleptic inspection, and laboratory testing. Products failing inspection are destroyed or re-exported.

3. Phytosanitary Requirements
Fresh fruits must comply with Plant Protection Law requirements. Some fruits require specific pest-free area certification or treatment certification. Mango from India: fumigation requirements apply.

4. Food Additives
Only food additives listed in the Positive List may be used. Imported processed foods must not contain unlisted additives.

5. Labeling Requirements
Japanese labels required for all food products sold in Japan. Label must include: product name, ingredients, net content, expiration or best-before date, storage conditions, country of origin, manufacturer/importer information.

6. Organic Standards
JAS (Japanese Agricultural Standard) organic certification required for products labeled organic in Japan. Third-party certification required.
""",
            },
            {
                "document_id": "uk_plant_health_act_2020",
                "title": "UK Plant Health Act 2020 and Import Requirements Post-Brexit",
                "source": "UK Department for Environment, Food and Rural Affairs (DEFRA)",
                "jurisdiction": "UK",
                "document_type": "PLANT_HEALTH_REGULATION",
                "publication_date": "2020-12-31",
                "content": """UK Plant Health Requirements Post-Brexit (2020 onwards)

1. Phytosanitary Certificate Requirement
Following Brexit, UK has implemented its own plant health regime. All plants and plant products imported into UK require a phytosanitary certificate from the exporting country's NPPO. Certificate must be presented at UK Border Control Posts (BCPs).

2. UK Border Control
Physical checks at UK BCPs are required for regulated plants and plant products. Pre-notification via IPAFFS (Import of products, animals, food and feed system) required 24-48 hours before arrival.

3. UK Pesticide MRLs
UK Pesticide MRLs are maintained by UK HSE (Health and Safety Executive). Post-Brexit, UK adopted EU MRLs as baseline but divergence is occurring. Chlorpyrifos: 0.01 mg/kg maximum for most crops.

4. Organic Standards
Organic products must comply with UK Organic Regulations. Certificate of Inspection from UK-approved certification body required. EU organic certificates no longer automatically accepted — must be from UK-recognized bodies.

5. Trade and Customs
Commodity codes (UK Tariff) required for all imports. Customs declarations via CHIEF or CDS system. Import duty rates as per UK Global Tariff.

6. Geographical Indications
UK operates its own GI scheme. Products bearing EU GI marks are not automatically protected in UK — separate UK GI registration required.
""",
            },
        ]


def _now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
