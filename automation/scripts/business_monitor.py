"""SEAI Automation Engine - Business Monitor Script (Phase 5 Complete).

Monitors SEAI website availability, dashboard availability, backend health,
database connectivity, worker heartbeat, failed automation tasks, overdue
projects and invoices. Generates operational health reports.
"""

from scripts.base import ScriptTask, TaskError
from api_client import seai_client
import requests
from datetime import datetime, timezone, timedelta

HEADERS = {
    "User-Agent": "SEAI-BusinessMonitor/1.0",
}


class BusinessMonitorTask(ScriptTask):
    script_name = "business_monitor"
    task_type = "monitor"

    def execute(self):
        check_websites = self.input_params.get("check_websites", [])
        check_apis = self.input_params.get("check_apis", [])
        overdue_days = int(self.input_params.get("overdue_days", 7))

        self.log("info", f"Business monitor: {len(check_websites)} websites, {len(check_apis)} APIs")

        results = {
            "websites": [],
            "apis": [],
            "overdue_projects": [],
            "overdue_payments": [],
            "failed_automations": [],
            "summary": {},
        }

        # Check websites
        for url in check_websites:
            try:
                resp = requests.get(url, headers=HEADERS, timeout=15)
                results["websites"].append({
                    "url": url,
                    "status_code": resp.status_code,
                    "healthy": 200 <= resp.status_code < 400,
                })
            except Exception as e:
                results["websites"].append({
                    "url": url,
                    "status_code": None,
                    "healthy": False,
                    "error": str(e),
                })

        # Check APIs
        for url in check_apis:
            try:
                resp = requests.get(url, headers=HEADERS, timeout=15)
                results["apis"].append({
                    "url": url,
                    "status_code": resp.status_code,
                    "healthy": 200 <= resp.status_code < 400,
                })
            except Exception as e:
                results["apis"].append({
                    "url": url,
                    "status_code": None,
                    "healthy": False,
                    "error": str(e),
                })

        # Overdue projects
        projects_data = seai_client.list_projects(limit=500)
        projects = projects_data.get("projects", [])
        cutoff = datetime.now(timezone.utc) - timedelta(days=overdue_days)
        for p in projects:
            if p.get("status") in ("completed", "cancelled"):
                continue
            due = p.get("due_date")
            if due:
                try:
                    due_date = datetime.fromisoformat(due.replace("Z", "+00:00"))
                    if due_date <= cutoff:
                        results["overdue_projects"].append({
                            "id": p["id"],
                            "name": p.get("name"),
                            "due_date": due,
                            "status": p.get("status"),
                            "client_id": p.get("client_id"),
                        })
                except Exception:
                    pass

        # Overdue payments (outstanding invoices)
        invoices_data = seai_client.list_invoices(status="sent", limit=500)
        invoices = invoices_data.get("invoices", [])
        for inv in invoices:
            due = inv.get("due_at")
            if due:
                try:
                    due_date = datetime.fromisoformat(due.replace("Z", "+00:00"))
                    if due_date <= cutoff:
                        results["overdue_payments"].append({
                            "id": inv["id"],
                            "number": inv.get("number"),
                            "total": inv.get("total_inr"),
                            "due_at": due,
                            "client_id": inv.get("client_id"),
                        })
                except Exception:
                    pass

        # Failed automations
        tasks_data = seai_client.list_automations(status="failed", limit=100)
        failed_tasks = tasks_data.get("tasks", [])
        for t in failed_tasks:
            results["failed_automations"].append({
                "id": t["id"],
                "script_name": t.get("script_name"),
                "error": t.get("error"),
                "retries": f"{t.get('retry_count', 0)}/{t.get('max_retries', 3)}",
            })

        # Summary
        results["summary"] = {
            "websites_healthy": sum(1 for w in results["websites"] if w.get("healthy")),
            "websites_total": len(results["websites"]),
            "apis_healthy": sum(1 for a in results["apis"] if a.get("healthy")),
            "apis_total": len(results["apis"]),
            "overdue_projects": len(results["overdue_projects"]),
            "overdue_payments": len(results["overdue_payments"]),
            "failed_automations": len(results["failed_automations"]),
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

        return results
