"""SEAI Automation Engine - Base task class."""
import json
import traceback
from datetime import datetime, timezone
from registry import get_task_definition, validate_input
from db import (
    insert_task, get_task, update_task_status, increment_retry,
    add_log, get_logs
)


class TaskError(Exception):
    """Raised when a task fails."""
    pass


class BaseTask:
    """Base class for all automation tasks."""

    script_name = None
    task_type = None

    def __init__(self, task_id, input_params, created_by=None):
        self.task_id = task_id
        self.input_params = input_params or {}
        self.created_by = created_by
        self.output = None
        self.error = None
        self.status = "pending"

    def log(self, level, message, details=None):
        """Add a log entry."""
        add_log(self.task_id, level, message, details)
        print(f"[{level.upper()}] {message}")

    def run(self):
        """Execute the task. Returns (status, output, error)."""
        self.status = "running"
        update_task_status(self.task_id, "running", started_at=datetime.now(timezone.utc).isoformat())
        self.log("info", f"Starting task {self.task_id} ({self.script_name})")

        try:
            # Validate input
            is_valid, error_msg = validate_input(self.script_name, self.input_params)
            if not is_valid:
                raise TaskError(f"Input validation failed: {error_msg}")

            # Execute the task logic
            self.output = self.execute()

            self.status = "completed"
            update_task_status(
                self.task_id,
                "completed",
                output=self.output,
                completed_at=datetime.now(timezone.utc).isoformat(),
            )
            self.log("info", f"Task {self.task_id} completed successfully")
            return "completed", self.output, None

        except TaskError as e:
            self.error = str(e)
            self.status = "failed"
            self.log("error", f"Task {self.task_id} failed: {self.error}")
            update_task_status(
                self.task_id,
                "failed",
                error=self.error,
                completed_at=datetime.now(timezone.utc).isoformat(),
            )
            return "failed", None, self.error

        except Exception as e:
            self.error = f"Unexpected error: {str(e)}\n{traceback.format_exc()}"
            self.status = "failed"
            self.log("error", f"Task {self.task_id} crashed: {self.error}")
            update_task_status(
                self.task_id,
                "failed",
                error=self.error,
                completed_at=datetime.now(timezone.utc).isoformat(),
            )
            return "failed", None, self.error

    def execute(self):
        """Subclasses must implement this. Returns output data."""
        raise NotImplementedError("Subclasses must implement execute()")


def create_task(script_name, input_params, created_by=None, max_retries=3, timeout_seconds=300):
    """Create a new task in the database. Returns task_id."""
    definition = get_task_definition(script_name)
    if not definition:
        raise ValueError(f"Script '{script_name}' is not registered")

    task_id = insert_task({
        "script_name": script_name,
        "task_type": definition["task_type"],
        "input_params": input_params,
        "max_retries": max_retries,
        "timeout_seconds": timeout_seconds,
        "created_by": created_by,
    })

    add_log(task_id, "info", f"Task created: {script_name}", {"input_params": input_params})
    return task_id


def get_task_status(task_id):
    """Get task status and details."""
    return get_task(task_id)


def get_task_logs(task_id, limit=100):
    """Get logs for a task."""
    return get_logs(task_id, limit)
