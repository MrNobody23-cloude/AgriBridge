"""
train.py — Master Orchestrator for AgriBridge ML Engine
Imports all 6 agents and calls .train_and_save() on each in sequence.
Each agent trains and saves independently — if one fails, a clear error is raised.
"""
import sys
import os

# Ensure the ml-engine root is on the path so all agents can import utils
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

from agents import traceability, quality, spoilage, fraud, compliance, trust

AGENTS = [traceability, quality, spoilage, fraud, compliance, trust]

if __name__ == "__main__":
    all_metrics = {}

    for agent_module in AGENTS:
        agent_name = agent_module.__name__.split('.')[-1]
        print(f"\n{'='*60}")
        print(f"Training: {agent_name.upper()}")
        print(f"{'='*60}")
        
        try:
            metrics = agent_module.train_and_save()
            all_metrics[agent_name] = metrics
            print(f"[OK] {agent_name} trained and saved successfully.")
            print(f"  Metrics: {metrics}")
        except RuntimeError:
            raise
        except Exception as e:
            raise RuntimeError(f"Training failed for agent '{agent_name}': {e}") from e

    print(f"\n{'='*60}")
    print("All 6 agents trained and saved successfully.")
    print(f"{'='*60}")
    print("\nSummary:")
    for agent_name, metrics in all_metrics.items():
        print(f"  [{agent_name}] {metrics}")
