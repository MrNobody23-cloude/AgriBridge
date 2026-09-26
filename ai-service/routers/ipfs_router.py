"""
IPFS Upload Router — Pinata integration.
All uploads go through backend; credentials never exposed to frontend.
"""
import os
import io
import logging
import requests
from fastapi import APIRouter, Request, HTTPException, UploadFile, File, Form
from typing import Optional

router = APIRouter()
logger = logging.getLogger("agribridge.ipfs")

PINATA_JWT = os.getenv("PINATA_JWT")
PINATA_API_KEY = os.getenv("PINATA_API_KEY")
PINATA_API_SECRET = os.getenv("PINATA_API_SECRET")
PINATA_GATEWAY = os.getenv("PINATA_GATEWAY_URL", "https://gateway.pinata.cloud")
PINATA_API_URL = "https://api.pinata.cloud"


def _get_headers() -> dict:
    if PINATA_JWT:
        return {"Authorization": f"Bearer {PINATA_JWT}"}
    elif PINATA_API_KEY and PINATA_API_SECRET:
        return {"pinata_api_key": PINATA_API_KEY, "pinata_secret_api_key": PINATA_API_SECRET}
    raise HTTPException(status_code=503, detail="IPFS credentials not configured. Set PINATA_JWT or PINATA_API_KEY/SECRET.")


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    batchId: Optional[str] = Form(None),
    docType: Optional[str] = Form("CERTIFICATE"),
):
    """Upload a file to IPFS via Pinata. Returns CID and file hash."""
    import hashlib

    MAX_SIZE = int(os.getenv("MAX_FILE_SIZE_MB", "10")) * 1024 * 1024
    ALLOWED_TYPES = os.getenv("ALLOWED_FILE_TYPES", "application/pdf,image/jpeg,image/png,image/webp").split(",")

    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail=f"File type {file.content_type} not allowed. Allowed: {ALLOWED_TYPES}")

    content = await file.read()
    if len(content) > MAX_SIZE:
        raise HTTPException(status_code=413, detail=f"File too large. Maximum: {MAX_SIZE // (1024*1024)} MB")

    # Compute SHA-256 hash
    file_hash = hashlib.sha256(content).hexdigest()

    headers = _get_headers()

    # Pin file to IPFS via Pinata
    try:
        files_payload = {"file": (file.filename, io.BytesIO(content), file.content_type)}
        metadata = {
            "name": file.filename,
            "keyvalues": {
                "batchId": batchId or "",
                "docType": docType or "CERTIFICATE",
                "fileHash": file_hash,
            },
        }
        import json
        response = requests.post(
            f"{PINATA_API_URL}/pinning/pinFileToIPFS",
            files=files_payload,
            data={"pinataMetadata": json.dumps(metadata)},
            headers=headers,
            timeout=60,
        )
        response.raise_for_status()
        result = response.json()
        cid = result["IpfsHash"]
        gateway_url = f"{PINATA_GATEWAY}/ipfs/{cid}"

        logger.info(f"✅ Uploaded to IPFS: {file.filename} → {cid}")
        return {
            "success": True,
            "ipfsCid": cid,
            "fileHash": file_hash,
            "filename": file.filename,
            "mimeType": file.content_type,
            "sizeBytes": len(content),
            "gatewayUrl": gateway_url,
            "batchId": batchId,
            "docType": docType,
        }
    except requests.HTTPError as e:
        logger.error(f"Pinata upload failed: {e.response.text if e.response else str(e)}")
        raise HTTPException(status_code=502, detail=f"IPFS upload failed: {str(e)}")
    except requests.RequestException as e:
        logger.error(f"IPFS network error: {e}")
        raise HTTPException(status_code=503, detail="IPFS service temporarily unavailable")


@router.get("/retrieve/{cid}")
async def get_ipfs_metadata(cid: str):
    """Get Pinata pin metadata for a CID."""
    try:
        headers = _get_headers()
        response = requests.get(
            f"{PINATA_API_URL}/data/pinList?hashContains={cid}",
            headers=headers,
            timeout=30,
        )
        response.raise_for_status()
        data = response.json()
        rows = data.get("rows", [])
        if not rows:
            raise HTTPException(status_code=404, detail=f"CID {cid} not found in Pinata")
        return {"success": True, "cid": cid, "gatewayUrl": f"{PINATA_GATEWAY}/ipfs/{cid}", "metadata": rows[0]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"IPFS metadata retrieval failed: {str(e)}")


@router.get("/status")
async def ipfs_status():
    """Check if IPFS/Pinata is configured and reachable."""
    if not PINATA_JWT and not (PINATA_API_KEY and PINATA_API_SECRET):
        return {"configured": False, "message": "PINATA credentials not set in environment"}
    try:
        headers = _get_headers()
        response = requests.get(f"{PINATA_API_URL}/data/testAuthentication", headers=headers, timeout=10)
        response.raise_for_status()
        return {"configured": True, "status": "healthy", "message": response.json().get("message", "Authenticated")}
    except Exception as e:
        return {"configured": True, "status": "unreachable", "error": str(e)}
