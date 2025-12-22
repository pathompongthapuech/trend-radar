from fastapi import FastAPI

app = FastAPI(title="Trend Radar Analyzer")

@app.get("/health")
def health():
    return {"ok": True}
