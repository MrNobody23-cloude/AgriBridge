# AgriBridge ML Engine — System Overview & Build Standards

This file defines how ALL 6 agent models must be built, so every agent follows the same quality bar and structure. Read this fully before writing any code. The per-agent detailed requirements are in 02-agent-instructions.md.

## 1. Folder Structure (must match exactly)
```
AgriBridge/
└── ai-service/
    └── ml-engine/
        ├── train.py          # orchestrator: imports all 6 agents, calls .train_and_save() on each
        ├── api.py            # FastAPI app, one endpoint per agent
        ├── evaluate.py       # runs & prints/saves metrics for all 6 agents
        ├── utils.py          # shared helpers: save/load pickle, shared constants
        ├── README.md
        │
        ├── specs/             # specification documents
        │   ├── 01-overview.md
        │   └── 02-agent-instructions.md
        │
        ├── agents/
        │   ├── traceability.py
        │   ├── quality.py
        │   ├── spoilage.py
        │   ├── fraud.py
        │   ├── compliance.py
        │   ├── trust.py
        │   └── WALKTHROUGH.md   # plain-English explanation of how each model works
        │
        ├── data/              # generated synthetic datasets land here
        ├── models/            # trained .pkl files land here
        └── results/           # metrics reports + plots, one subfolder per agent
```

Do not deviate from this structure. Do not create extra top-level folders unless explicitly instructed.

## 2. Per-Agent File Contract

Every file inside `agents/` (`traceability.py`, `quality.py`, `spoilage.py`, `fraud.py`, `compliance.py`, `trust.py`) must expose exactly these functions, in this order, with this naming convention (so `train.py` and `evaluate.py` can call them identically across all 6 agents):

```python
def generate_data(n_samples: int = 1500) -> pd.DataFrame:
    """Builds and returns a realistic synthetic dataset for this agent."""

def build_model():
    """Returns an untrained model/pipeline (preprocessing + estimator)."""

def train_and_save(save_dir: str = "models/") -> dict:
    """
    Runs generate_data() -> build_model() -> fit -> evaluate -> save pickle.
    Returns a dict of key metrics (for train.py to print/log).
    Only saves the pickle AFTER training completes and metrics are computed
    — never save a partially trained or untested model.
    """

def evaluate(model, X_test, y_test) -> dict:
    """
    Computes and returns metrics appropriate to this agent's task type
    (regression -> MAE/RMSE/R²; classification -> precision/recall/F1/confusion matrix;
    anomaly detection -> precision/recall/F1 against injected ground-truth labels).
    Also saves plots to results/<agent_name>/.
    """

def predict(input_dict: dict) -> dict:
    """
    Takes a single raw input (matching this agent's input schema) and returns
    the exact output JSON contract defined for this agent in 02-agent-instructions.md.
    This is the function api.py calls per request.
    """
```

This identical shape across all 6 agents is mandatory — it's what makes `train.py` a simple loop instead of custom logic per agent.

## 3. Data Generation Standards (applies to every agent)
- All data is synthetic — no real datasets are needed or expected for this project.
- Every synthetic dataset must be realistically grounded: use real-world plausible ranges (actual crop temperature/humidity thresholds, realistic transport durations, realistic fraud transaction patterns) — never arbitrary random numbers with no basis. Add a short code comment next to each range explaining why that range was chosen.
- Add realistic noise — no perfectly clean formulas. Real-world data is messy.
- Minimum 1000–2000 rows per agent, unless the agent's spec says otherwise.
- For classification/anomaly agents: check class balance. If naturally imbalanced (e.g. fraud), keep it imbalanced (mirrors reality) but handle it properly in training (class weighting, stratified split, or SMOTE) — do not artificially balance it into a 50/50 split.
- Before training on any new dataset, print a 10–15 row sample and a correlation/EDA summary, and explicitly check for label leakage (no single feature should trivially reveal the target). Flag this in `results/<agent_name>/eda_notes.md`.

## 4. Model Selection Standards
- Match the model type to the problem:
  - Regression target (a continuous score/number) → RandomForestRegressor or XGBoost Regressor
  - Classification target (a category/label) → RandomForestClassifier or XGBoost Classifier
  - No ground-truth labels, detecting outliers → IsolationForest
- Always wrap preprocessing (`OneHotEncoder` for categoricals, `StandardScaler` for numerics) and the estimator together in a single `sklearn.Pipeline`, so the saved `.pkl` is self-contained and `predict()` doesn't need to redo preprocessing manually.
- Use `random_state=42` everywhere for reproducibility.
- Prioritize a model that's simple enough to explain in a viva over a marginally more accurate but harder-to-explain one.

## 5. Evaluation Standards (applies to every agent)

Every agent must report, minimum:
- Train/test split (80/20, stratified for classification)
- Appropriate metrics for its task type (see section 2)
- Feature importances (for tree-based models) — save as a bar chart
- One plot minimum: actual-vs-predicted (regression) or confusion matrix (classification/anomaly)
- A short honest "limitations" note (e.g. "recall on rare class is lower than precision")

All of this must be saved to `results/<agent_name>/` — metrics as a `.json` or `.txt`, plots as `.png`.

## 6. Confidence Score Standard

Every agent's `predict()` output must include a `confidence_score` (0–100), derived consistently:
- Regression models: derive from prediction variance across trees (e.g. std dev across individual RandomForest tree predictions, normalized to 0–100)
- Classification models: derive from `predict_proba()` — the probability of the predicted class, scaled to 0–100
- Anomaly detection: derive from `decision_function()` distance from the boundary, normalized to 0–100

Do not hardcode or fake confidence scores — they must come from the model itself.

## 7. Output Contract Standard

Every agent's `predict()` must return clean JSON-serializable Python dicts (no numpy types — cast to native float/int/str), matching exactly the schema defined per-agent in `02-agent-instructions.md`. `api.py` will pass this straight back as the HTTP response body.

## 8. train.py Orchestration Standard
```python
from agents import traceability, quality, spoilage, fraud, compliance, trust

AGENTS = [traceability, quality, spoilage, fraud, compliance, trust]

if __name__ == "__main__":
    for agent_module in AGENTS:
        print(f"\n{'='*60}\nTraining: {agent_module.__name__}\n{'='*60}")
        metrics = agent_module.train_and_save()
        print(metrics)
    print("\nAll 6 agents trained and saved successfully.")
```

Each agent trains and saves independently — if one fails, it should raise a clear error, not silently skip.

## 9. api.py Standard

One FastAPI app, one POST endpoint per agent, all loading their respective pickled model once at startup (not per-request):
- `POST /predict/traceability`
- `POST /predict/quality`
- `POST /predict/spoilage`
- `POST /predict/fraud`
- `POST /predict/compliance`
- `POST /predict/trust`

Each endpoint accepts a JSON body matching that agent's input schema and returns its defined output contract.

## 10. WALKTHROUGH.md Standard

After all 6 agents are built and trained, generate `agents/WALKTHROUGH.md` with one identically structured section per agent:

```markdown
## [Agent Name]
**What it predicts:**
**Inputs:**
**Output:**
**Model used & why:**
**How the target/label was derived (synthetic data logic):**
**Key metrics achieved:**
**Top features driving the prediction:**
**Known limitation:**
```

This file is for the student's own understanding and viva prep — write it in plain, simple English, not jargon-heavy documentation style.

## 11. Build Order

Build and fully test one agent at a time, in this order, before moving to the next:
1. Traceability
2. Quality Intelligence
3. Spoilage Prediction
4. Fraud Detection
5. Compliance
6. Consumer Trust

After each agent, run its `evaluate()`, show the results, and wait for confirmation before moving to the next agent — do not build all 6 blindly in one shot.
