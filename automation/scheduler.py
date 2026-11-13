"""SEAI Automation Engine - Task Scheduler.

Cron-style scheduling for recurring automation tasks.
Uses the `schedule` library for simple interval/cron expressions.
"""

import schedule
import time
import threading
from datetime import datetime, timezone
from db import get_active_schedules, insert_schedule, update_schedule_next_run, add_log
from manager import create_task
from config import WORKER_POLL_INTERVAL_SECONDS


class Scheduler:
    """Scheduler that creates tasks based on schedule definitions."""

    def __init__(self):
        self.running = False
        self._thread = None
        self._stop = False

    def start(self):
        """Start the scheduler in a background thread."""
        self.running = True
        self._stop = False
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        print("[Scheduler] Started")

    def stop(self):
        """Stop the scheduler."""
        self._stop = True
        self.running = False
        if self._thread:
            self._thread.join(timeout=5)
        print("[Scheduler] Stopped")

    def _loop(self):
        """Main scheduler loop - checks for due schedules."""
        while not self._stop:
            try:
                self._check_due()
            except Exception as e:
                print(f"[Scheduler] Error: {e}")
            time.sleep(WORKER_POLL_INTERVAL_SECONDS)

    def _check_due(self):
        """Check for schedules that are due to run."""
        schedules = get_active_schedules()
        now = datetime.now(timezone.utc)

        for sched in schedules:
            next_run = sched.get("next_run_at")
            if not next_run:
                # First run - schedule it
                self._run_schedule(sched)
                continue

            # Parse next_run_at
            if isinstance(next_run, str):
                next_run = datetime.fromisoformat(next_run.replace("Z", "+00:00"))

            if next_run <= now:
                self._run_schedule(sched)

    def _run_schedule(self, sched):
        """Create a task from a schedule and update next_run."""
        schedule_id = sched["id"]
        script_name = sched["script_name"]
        input_params = sched["input_params"] or {}

        print(f"[Scheduler] Running scheduled task: {script_name}")

        # Create a task
        task_id = create_task(
            script_name=script_name,
            input_params=input_params,
            created_by="scheduler",
        )
        add_log(schedule_id, "info", f"Created task {task_id} from schedule {script_name}")

        # Calculate next run (simple: every hour for now, or parse cron)
        # For MVP, we use a simple hourly recurrence
        from datetime import timedelta
        next_run = datetime.now(timezone.utc) + timedelta(hours=1)
        update_schedule_next_run(schedule_id, next_run.isoformat(), last_run_at=now.isoformat())

    def add_schedule(self, script_name, input_params, cron_expression, next_run_at=None):
        """Add a new schedule."""
        return insert_schedule({
            "script_name": script_name,
            "input_params": input_params,
            "cron_expression": cron_expression,
            "next_run_at": next_run_at,
        })


# Singleton instance
scheduler = Scheduler()
