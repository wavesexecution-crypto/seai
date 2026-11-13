"""SEAI Automation Engine - Background worker loop.

Polls the database for pending tasks, executes them one at a time,
and updates their status. One failed task never crashes the worker.
"""

import os
import sys

# Ensure the automation package directory is on sys.path so that absolute
# imports like `from db import ...`, `from manager import ...`,
# `from scripts.base import ...` work both when run as
# `python automation/worker.py` and as `python -m automation.worker`.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import time
import signal
from db import get_pending_tasks, update_task_status, increment_retry, add_log
from manager import create_task, get_task_status, BaseTask, TaskError
from registry import get_task_definition, is_registered
from config import (
    WORKER_POLL_INTERVAL_SECONDS,
    TASK_TIMEOUT_SECONDS,
    SEAI_OPS_EMAIL,
    SEAI_OPS_PASSWORD,
)
import importlib


def _log(msg):
    """Unbuffered log."""
    print(msg, flush=True)


class Worker:
    """Background worker that processes automation tasks."""

    def __init__(self, poll_interval=None):
        self.poll_interval = poll_interval or WORKER_POLL_INTERVAL_SECONDS
        self.running = False
        self._stop_requested = False

    def stop(self, signum=None, frame=None):
        self._stop_requested = True
        self.running = False
        print("\n[Worker] Stop requested. Shutting down gracefully...")

    def run(self):
        """Main worker loop."""
        signal.signal(signal.SIGINT, self.stop)
        signal.signal(signal.SIGTERM, self.stop)

        self.running = True
        _log(f"[Worker] Starting automation worker (poll interval: {self.poll_interval}s)")

        # Sign in to the SEAI backend for session-based API access
        from api_client import seai_client
        if SEAI_OPS_EMAIL and SEAI_OPS_PASSWORD:
            try:
                seai_client.sign_in(SEAI_OPS_EMAIL, SEAI_OPS_PASSWORD)
                _log("[Worker] Signed in to SEAI backend successfully")
            except Exception as e:
                _log(f"[Worker] Sign-in failed: {e}. Staff API routes will fail.")
        else:
            _log("[Worker] No operator credentials set. Staff API routes will fail.")

        while self.running and not self._stop_requested:
            try:
                self._process_cycle()
            except Exception as e:
                _log(f"[Worker] Unexpected error in cycle: {e}")

            if not self._stop_requested:
                time.sleep(self.poll_interval)

        self.running = False
        _log("[Worker] Stopped.")

    def _process_cycle(self):
        """Poll for pending tasks and execute them."""
        tasks = get_pending_tasks(limit=5)

        if not tasks:
            return

        _log(f"[Worker] Found {len(tasks)} pending task(s)")

        for task in tasks:
            if self._stop_requested:
                break

            self._execute_task(task)

    def _execute_task(self, task):
        """Execute a single task with error isolation."""
        task_id = task["id"]
        script_name = task["script_name"]
        input_params = task["input_params"] or {}

        _log(f"[Worker] Executing task {task_id}: {script_name}")

        # Mark as running
        from datetime import datetime, timezone
        update_task_status(
            task_id,
            "running",
            started_at=datetime.now(timezone.utc).isoformat(),
        )
        add_log(task_id, "info", f"Worker picked up task: {script_name}")

        try:
            # Dynamically import and instantiate the task class
            definition = get_task_definition(script_name)
            if not definition:
                raise TaskError(f"Script '{script_name}' is not registered")

            module = importlib.import_module(definition["module"])
            task_class = getattr(module, definition["class"])

            instance = task_class(task_id, input_params)
            status, output, error = instance.run()

            if status == "failed":
                # Handle retry
                current_retries = task["retry_count"] or 0
                max_retries = task["max_retries"] or 3

                if current_retries < max_retries:
                    increment_retry(task_id)
                    add_log(task_id, "warn", f"Task failed, will retry ({current_retries + 1}/{max_retries}): {error}")
                    # Reset to pending for retry
                    update_task_status(task_id, "pending")
                else:
                    add_log(task_id, "error", f"Task failed permanently after {max_retries} retries: {error}")
            else:
                add_log(task_id, "info", f"Task completed: {script_name}")

        except Exception as e:
            error_msg = f"Worker error executing {script_name}: {str(e)}"
            _log(f"[Worker] {error_msg}")
            add_log(task_id, "error", error_msg)

            current_retries = task["retry_count"] or 0
            max_retries = task["max_retries"] or 3

            if current_retries < max_retries:
                increment_retry(task_id)
                update_task_status(task_id, "pending")
            else:
                update_task_status(task_id, "failed", error=error_msg)


if __name__ == "__main__":
    worker = Worker()
    worker.run()
