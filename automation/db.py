"""SEAI Automation Engine - Database helpers (Neon PostgreSQL)."""
import json
import uuid
import psycopg2
import psycopg2.extras
from contextlib import contextmanager
from config import DATABASE_URL


def get_connection():
    """Get a PostgreSQL connection."""
    return psycopg2.connect(DATABASE_URL)


@contextmanager
def db_connection():
    """Context manager for DB connections."""
    conn = get_connection()
    try:
        yield conn
    finally:
        conn.close()


def execute_query(query, params=None, fetch=False, fetchone=False):
    """Execute a SQL query."""
    with db_connection() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(query, params or ())
            if fetchone:
                result = cur.fetchone()
            elif fetch:
                result = cur.fetchall()
            else:
                result = cur.rowcount
            conn.commit()
            return result


def insert_task(task):
    """Insert a new automation task. Returns the task id."""
    task_id = task.get("id") or str(uuid.uuid4())
    query = """
        INSERT INTO automation_tasks
        (id, script_name, task_type, input_params, status, max_retries, timeout_seconds, created_by, created_at, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, now(), now())
        RETURNING id
    """
    params = (
        task_id,
        task["script_name"],
        task["task_type"],
        json.dumps(task.get("input_params", {})),
        "pending",
        task.get("max_retries", 3),
        task.get("timeout_seconds", 300),
        task.get("created_by"),
    )
    result = execute_query(query, params, fetchone=True)
    return result["id"]


def get_pending_tasks(limit=10):
    """Get pending tasks ordered by creation time."""
    query = """
        SELECT id, script_name, task_type, input_params, status, retry_count,
               max_retries, timeout_seconds, created_at
        FROM automation_tasks
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT %s
    """
    return execute_query(query, (limit,), fetch=True)


def get_task(task_id):
    """Get a single task by id."""
    query = "SELECT * FROM automation_tasks WHERE id = %s"
    return execute_query(query, (task_id,), fetchone=True)


def update_task_status(task_id, status, output=None, error=None, started_at=None, completed_at=None):
    """Update task status and optional output/error."""
    sets = ["status = %s", "updated_at = now()"]
    params = [status]

    if output is not None:
        sets.append("output = %s")
        params.append(json.dumps(output))
    if error is not None:
        sets.append("error = %s")
        params.append(error)
    if started_at is not None:
        sets.append("started_at = %s")
        params.append(started_at)
    if completed_at is not None:
        sets.append("completed_at = %s")
        params.append(completed_at)

    params.append(task_id)
    query = f"UPDATE automation_tasks SET {', '.join(sets)} WHERE id = %s"
    execute_query(query, tuple(params))


def increment_retry(task_id):
    """Increment retry count."""
    query = "UPDATE automation_tasks SET retry_count = retry_count + 1, updated_at = now() WHERE id = %s"
    execute_query(query, (task_id,))


def add_log(task_id, level, message, details=None):
    """Add a structured log entry."""
    log_id = str(uuid.uuid4())
    query = """
        INSERT INTO automation_logs (id, task_id, level, message, details, created_at)
        VALUES (%s, %s, %s, %s, %s, now())
    """
    params = (log_id, task_id, level, message, json.dumps(details) if details else None)
    execute_query(query, params)
    return log_id


def get_logs(task_id, limit=100):
    """Get logs for a task."""
    query = """
        SELECT id, level, message, details, created_at
        FROM automation_logs
        WHERE task_id = %s
        ORDER BY created_at DESC
        LIMIT %s
    """
    return execute_query(query, (task_id, limit), fetch=True)


def get_all_tasks(status=None, limit=100):
    """Get all tasks, optionally filtered by status."""
    if status:
        query = """
            SELECT id, script_name, task_type, status, retry_count, max_retries,
                   started_at, completed_at, error, created_at, updated_at
            FROM automation_tasks
            WHERE status = %s
            ORDER BY created_at DESC
            LIMIT %s
        """
        return execute_query(query, (status, limit), fetch=True)
    query = """
        SELECT id, script_name, task_type, status, retry_count, max_retries,
               started_at, completed_at, error, created_at, updated_at
        FROM automation_tasks
        ORDER BY created_at DESC
        LIMIT %s
    """
    return execute_query(query, (limit,), fetch=True)


def insert_schedule(schedule):
    """Insert a scheduled task."""
    schedule_id = schedule.get("id") or str(uuid.uuid4())
    query = """
        INSERT INTO automation_schedules
        (id, script_name, input_params, cron_expression, is_active, next_run_at, created_at, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, now(), now())
        RETURNING id
    """
    params = (
        schedule_id,
        schedule["script_name"],
        json.dumps(schedule.get("input_params", {})),
        schedule["cron_expression"],
        schedule.get("is_active", True),
        schedule.get("next_run_at"),
    )
    result = execute_query(query, params, fetchone=True)
    return result["id"]


def get_active_schedules():
    """Get active schedules due to run."""
    query = """
        SELECT id, script_name, input_params, cron_expression, next_run_at
        FROM automation_schedules
        WHERE is_active = true
          AND (next_run_at IS NULL OR next_run_at <= now())
        ORDER BY next_run_at ASC NULLS FIRST
    """
    return execute_query(query, fetch=True)


def update_schedule_next_run(schedule_id, next_run_at, last_run_at=None):
    """Update schedule's next run time."""
    sets = ["next_run_at = %s", "updated_at = now()"]
    params = [next_run_at]
    if last_run_at is not None:
        sets.append("last_run_at = %s")
        params.append(last_run_at)
    params.append(schedule_id)
    query = f"UPDATE automation_schedules SET {', '.join(sets)} WHERE id = %s"
    execute_query(query, tuple(params))
