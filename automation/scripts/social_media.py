"""SEAI Automation Engine - Social Media Script.

Retrieves analytics, publishing history, and prepares content.
Publishing requires explicit owner approval (approve_publish=true).
Integrates with SEAI's social_integrations table for stored OAuth tokens.
"""

from scripts.base import ScriptTask, TaskError
from api_client import seai_client


class SocialMediaTask(ScriptTask):
    script_name = "social_media"
    task_type = "social"

    def execute(self):
        platform = self.input_params.get("platform", "")
        action = self.input_params.get("action", "")
        account_id = self.input_params.get("account_id")
        content = self.input_params.get("content")
        schedule_at = self.input_params.get("schedule_at")
        approve_publish = self.input_params.get("approve_publish", False)

        if not platform:
            raise TaskError("Missing required parameter: platform")
        if not action:
            raise TaskError("Missing required parameter: action")

        self.log("info", f"Social media: platform={platform}, action={action}")

        # Fetch connected integrations
        integrations_data = seai_client.list_social_integrations(limit=100)
        integrations = integrations_data.get("integrations", [])

        # Filter by platform and account
        matching = [i for i in integrations if i.get("platform") == platform]
        if account_id:
            matching = [i for i in matching if i.get("account_id") == account_id]

        if not matching:
            return {
                "platform": platform,
                "action": action,
                "message": f"No connected {platform} integrations found. Connect accounts in Settings first.",
                "integrations_connected": 0,
            }

        result = {
            "platform": platform,
            "action": action,
            "integrations_connected": len(matching),
            "accounts": [],
        }

        for acct in matching:
            acct_info = {
                "account_id": acct.get("account_id"),
                "account_name": acct.get("account_name"),
                "health_status": acct.get("health_status"),
            }

            if action == "analytics":
                acct_info["note"] = "Analytics retrieval requires platform API implementation"
            elif action == "publish":
                if not content:
                    acct_info["error"] = "Content required for publish action"
                elif not approve_publish:
                    acct_info["status"] = "pending_approval"
                    acct_info["note"] = "Content prepared but not published - owner approval required"
                else:
                    acct_info["status"] = "approved_for_publish"
                    acct_info["note"] = "Approved - publish via n8n workflow or platform API"
                acct_info["content_preview"] = content[:100] if content else None
                acct_info["schedule_at"] = schedule_at
            elif action == "reports":
                acct_info["note"] = "Campaign reports retrieval requires platform API implementation"

            result["accounts"].append(acct_info)

        return result
