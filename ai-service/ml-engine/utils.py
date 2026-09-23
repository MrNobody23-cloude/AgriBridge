import os
import pickle
import json
import matplotlib
matplotlib.use('Agg')  # Non-interactive backend for server environments
import matplotlib.pyplot as plt
import seaborn as sns

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
MODELS_DIR = os.path.join(BASE_DIR, "models")
RESULTS_DIR = os.path.join(BASE_DIR, "results")

def ensure_directories():
    """Ensures all standard subdirectories exist."""
    for path in [DATA_DIR, MODELS_DIR, RESULTS_DIR]:
        os.makedirs(path, exist_ok=True)

def get_agent_results_dir(agent_name: str) -> str:
    """Returns directory path for storing an agent's evaluation results & plots."""
    path = os.path.join(RESULTS_DIR, agent_name)
    os.makedirs(path, exist_ok=True)
    return path

def save_pickle(obj, filename: str):
    """Saves a model object to the models/ directory as a .pkl file."""
    ensure_directories()
    filepath = os.path.join(MODELS_DIR, filename)
    with open(filepath, 'wb') as f:
        pickle.dump(obj, f)
    print(f"Model saved successfully to {filepath}")

def load_pickle(filename: str):
    """Loads and returns a serialized model object from the models/ directory."""
    filepath = os.path.join(MODELS_DIR, filename)
    if not os.path.exists(filepath):
        raise FileNotFoundError(f"Model file not found at {filepath}")
    with open(filepath, 'rb') as f:
        return pickle.load(f)

def save_metrics_json(metrics: dict, agent_name: str, filename: str = "metrics.json"):
    """Saves metrics dict into results/<agent_name>/metrics.json."""
    agent_dir = get_agent_results_dir(agent_name)
    filepath = os.path.join(agent_dir, filename)
    
    # Cast numpy/non-serializable types
    clean_metrics = {}
    for k, v in metrics.items():
        if isinstance(v, (int, float, str, bool, list, dict)) or v is None:
            clean_metrics[k] = v
        else:
            clean_metrics[k] = str(v)
            
    with open(filepath, 'w') as f:
        json.dump(clean_metrics, f, indent=4)
    print(f"Metrics saved to {filepath}")

def save_eda_notes(agent_name: str, eda_content: str):
    """Saves EDA summary and label leakage report to results/<agent_name>/eda_notes.md."""
    agent_dir = get_agent_results_dir(agent_name)
    filepath = os.path.join(agent_dir, "eda_notes.md")
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(eda_content)
    print(f"EDA notes saved to {filepath}")
