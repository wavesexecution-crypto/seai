"""SEAI Automation Engine - Base script class for individual task scripts."""
from manager import BaseTask, TaskError


class ScriptTask(BaseTask):
    """Base class for individual task scripts."""

    def execute(self):
        """Subclasses implement this. Returns a dict of output data."""
        raise NotImplementedError

    def save_lead_to_crm(self, lead_data, seai_client):
        """Save a researched lead to the SEAI CRM with duplicate detection."""
        # Check for duplicates first
        dup_result = seai_client.check_duplicate(
            email=lead_data.get("email"),
            phone=lead_data.get("phone"),
            business_name=lead_data.get("business_name"),
        )

        if dup_result.get("duplicate"):
            self.log("info", f"Duplicate lead detected: {dup_result['duplicate']['business_name']} ({dup_result['duplicate']['reason']})")
            return {
                "action": "skipped_duplicate",
                "existing_lead_id": dup_result["duplicate"]["id"],
                "reason": dup_result["duplicate"]["reason"],
            }

        # Create the lead
        result = seai_client.create_lead(lead_data)
        if result.get("ok"):
            self.log("info", f"Created lead: {result.get('lead_ref')} - {lead_data.get('business_name')}")
            # Add an activity note
            seai_client.add_lead_activity(
                result["id"],
                "note",
                "Lead created by automation engine (lead_research)",
            )
            return {
                "action": "created",
                "lead_id": result["id"],
                "lead_ref": result.get("lead_ref"),
            }
        else:
            raise TaskError(f"Failed to create lead: {result.get('error')}")
