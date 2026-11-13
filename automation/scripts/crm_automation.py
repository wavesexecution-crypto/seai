"""SEAI Automation Engine - CRM Automation Script (Phase 4 Complete).

Detects duplicate leads, validates lead records, applies deterministic lead
scoring rules, identifies overdue follow-ups and inactive leads, and generates
daily CRM summaries. Updates records only according to explicit rules.

Never sends messages automatically without owner approval.
"""

from scripts.base import ScriptTask, TaskError
from api_client import seai_client
from datetime import datetime, timezone, timedelta


class CRMAutomationTask(ScriptTask):
    script_name = "crm_automation"
    task_type = "crm"

    def execute(self):
        action = self.input_params.get("action", "review")
        source = self.input_params.get("source")
        days_since_contact = int(self.input_params.get("days_since_contact", 7))

        self.log("info", f"CRM automation: action={action}, source={source}")

        # Fetch leads
        data = seai_client.list_leads(source=source, limit=1000)
        leads = data.get("leads", [])
        self.log("info", f"Fetched {len(leads)} leads")

        results = {
            "action": action,
            "leads_reviewed": len(leads),
            "updated": 0,
            "overdue_followups": 0,
            "inactive_leads": 0,
            "duplicate_leads": 0,
            "high_priority_leads": 0,
            "details": [],
        }

        from datetime import datetime, timezone, timedelta
        cutoff = datetime.now(timezone.utc) - timedelta(days=days_since_contact)

        for lead in leads:
            lead_id = lead["id"]
            detail = {
                "lead_id": lead_id,
                "business_name": lead.get("business_name"),
                "stage": lead.get("stage"),
                "source": lead.get("source"),
                "actions": [],
            }

            # 1. Detect duplicate leads
            dup_result = seai_client.check_duplicate(
                email=lead.get("email"),
                phone=lead.get("phone"),
                business_name=lead.get("business_name"),
            )
            if dup_result.get("duplicate") and dup_result.get("duplicate", {}).get("id") != lead_id:
                detail["actions"].append("potential_duplicate")
                results["duplicate_leads"] += 1

            # 2. Validate lead record
            validation_issues = []
            if not lead.get("business_name"):
                validation_issues.append("missing_business_name")
            if not lead.get("email") and not lead.get("phone"):
                validation_issues.append("missing_contact_info")
            if not lead.get("stage"):
                validation_issues.append("missing_stage")
            if validation_issues:
                detail["actions"].append(f"validation_issues:{','.join(validation_issues)}")

            # 3. Deterministic lead scoring
            score = 0
            if lead.get("estimated_budget_inr"):
                score += 20
            if lead.get("email"):
                score += 10
            if lead.get("phone"):
                score += 10
            if lead.get("website"):
                score += 10
            if lead.get("industry"):
                score += 10
            if lead.get("stage") == "qualified":
                score += 20
            elif lead.get("stage") == "proposal_sent":
                score += 15
            elif lead.get("stage") == "negotiation":
                score += 10
            if lead.get("priority") == "urgent":
                score += 10
            elif lead.get("priority") == "high":
                score += 5
            if score >= 60:
                detail["actions"].append(f"high_priority_score:{score}")
                results["high_priority_leads"] += 1
            detail["lead_score"] = score

            # 4. Identify overdue follow-ups
            next_follow_up = lead.get("next_follow_up_at")
            if next_follow_up and lead.get("stage") not in ("won", "lost"):
                try:
                    fu_date = datetime.fromisoformat(next_follow_up.replace("Z", "+00:00"))
                    if fu_date <= cutoff:
                        detail["actions"].append("follow_up_overdue")
                        results["overdue_followups"] += 1
                except Exception:
                    pass

            # 5. Identify inactive leads (no contact in X days)
            last_contacted = lead.get("last_contacted_at")
            if last_contacted and lead.get("stage") not in ("won", "lost"):
                try:
                    lc_date = datetime.fromisoformat(last_contacted.replace("Z", "+00:00"))
                    if lc_date <= cutoff:
                        detail["actions"].append("inactive_lead")
                        results["inactive_leads"] += 1
                except Exception:
                    pass

            if detail["actions"]:
                results["details"].append(detail)
                results["updated"] += 1

        return results
