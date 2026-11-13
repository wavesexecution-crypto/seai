"""SEAI Automation Engine - SEAI Backend API client."""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import requests
from config import SEAI_API_BASE
from manager import TaskError


class SEAIClient:
    """Client for the SEAI backend API.

    Uses session-based authentication: signs in with email/password and
    sends the session cookie on all subsequent requests.
    """

    def __init__(self):
        self.base_url = SEAI_API_BASE.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        self._authenticated = False

    def _ensure_auth(self):
        """Sign in if not already authenticated."""
        if self._authenticated:
            return
        self.sign_in(os.getenv("SEAI_OPS_EMAIL", "admin@seai.store"), os.getenv("SEAI_OPS_PASSWORD", "password123"))

    def sign_in(self, email, password):
        """Sign in with email/password and store the session cookie."""
        resp = self.session.post(
            f"{self.base_url}/api/auth/sign-in",
            json={"email": email, "password": password},
            timeout=30,
        )
        if resp.status_code == 200:
            self._authenticated = True
            return True
        raise TaskError(f"SEAI auth failed: {resp.status_code} {resp.text}")

    def _request(self, method, path, params=None, json=None, timeout=30):
        self._ensure_auth()
        url = f"{self.base_url}{path}"
        resp = self.session.request(method, url, params=params, json=json, timeout=timeout)
        resp.raise_for_status()
        return resp.json()

    # ---------- Leads ----------
    def list_leads(self, stage=None, source=None, limit=100):
        params = {"limit": limit}
        if stage:
            params["stage"] = stage
        if source:
            params["source"] = source
        return self._request("GET", "/api/staff/leads", params=params)

    def create_lead(self, lead_data):
        return self._request("POST", "/api/staff/leads", json=lead_data)

    def get_lead(self, lead_id):
        return self._request("GET", f"/api/staff/leads/{lead_id}")

    def update_lead(self, lead_id, patch):
        return self._request("PATCH", f"/api/staff/leads/{lead_id}", json=patch)

    def add_lead_activity(self, lead_id, activity_type, body, meta=None):
        payload = {"type": activity_type, "body": body}
        if meta:
            payload["meta"] = meta
        return self._request("POST", f"/api/staff/leads/{lead_id}/activity", json=payload)

    def check_duplicate(self, email=None, phone=None, business_name=None):
        payload = {}
        if email:
            payload["email"] = email
        if phone:
            payload["phone"] = phone
        if business_name:
            payload["business_name"] = business_name
        return self._request("POST", "/api/staff/leads/check-duplicate", json=payload)

    # ---------- Clients ----------
    def list_clients(self, status=None, limit=100):
        params = {"limit": limit}
        if status:
            params["status"] = status
        return self._request("GET", "/api/ops/clients", params=params)

    def create_client(self, client_data):
        return self._request("POST", "/api/ops/clients", json=client_data)

    def get_client(self, client_id):
        return self._request("GET", f"/api/ops/clients/{client_id}")

    def update_client(self, client_id, patch):
        return self._request("PATCH", f"/api/ops/clients/{client_id}", json=patch)

    # ---------- Projects ----------
    def list_projects(self, status=None, client_id=None, limit=100):
        params = {"limit": limit}
        if status:
            params["status"] = status
        if client_id:
            params["client_id"] = client_id
        return self._request("GET", "/api/ops/projects", params=params)

    def create_project(self, project_data):
        return self._request("POST", "/api/ops/projects", json=project_data)

    def get_project(self, project_id):
        return self._request("GET", f"/api/ops/projects/{project_id}")

    def update_project(self, project_id, patch):
        return self._request("PATCH", f"/api/ops/projects/{project_id}", json=patch)

    def create_project_task(self, project_id, task_data):
        return self._request("POST", f"/api/ops/projects/{project_id}/tasks", json=task_data)

    def update_task(self, task_id, patch):
        return self._request("PATCH", f"/api/ops/projects/tasks/{task_id}", json=patch)

    # ---------- Proposals ----------
    def list_proposals(self, status=None, limit=100):
        params = {"limit": limit}
        if status:
            params["status"] = status
        return self._request("GET", "/api/ops/proposals", params=params)

    def create_proposal(self, proposal_data):
        return self._request("POST", "/api/ops/proposals", json=proposal_data)

    def get_proposal(self, proposal_id):
        return self._request("GET", f"/api/ops/proposals/{proposal_id}")

    def update_proposal(self, proposal_id, patch):
        return self._request("PATCH", f"/api/ops/proposals/{proposal_id}", json=patch)

    def send_proposal(self, proposal_id):
        return self._request("POST", f"/api/ops/proposals/{proposal_id}/send")

    def decide_proposal(self, proposal_id, decision, rejection_reason=None):
        return self._request("POST", f"/api/ops/proposals/{proposal_id}/decide",
                            json={"decision": decision, "rejection_reason": rejection_reason})

    # ---------- Services ----------
    def list_services(self, limit=1000):
        return self._request("GET", "/api/ops/services", params={"limit": limit})

    def create_service(self, service_data):
        return self._request("POST", "/api/ops/services", json=service_data)

    def update_service(self, service_id, patch):
        return self._request("PATCH", f"/api/ops/services/{service_id}", json=patch)

    # ---------- Finance ----------
    def list_invoices(self, status=None, kind=None, client_id=None, limit=500):
        params = {"limit": limit}
        if status:
            params["status"] = status
        if kind:
            params["kind"] = kind
        if client_id:
            params["client_id"] = client_id
        return self._request("GET", "/api/ops/finance/invoices", params=params)

    def create_invoice(self, invoice_data):
        return self._request("POST", "/api/ops/finance/invoices", json=invoice_data)

    def get_invoice(self, invoice_id):
        return self._request("GET", f"/api/ops/finance/invoices/{invoice_id}")

    def update_invoice(self, invoice_id, patch):
        return self._request("PATCH", f"/api/ops/finance/invoices/{invoice_id}", json=patch)

    def get_finance_snapshot(self):
        return self._request("GET", "/api/ops/finance/snapshot")

    def create_expense(self, expense_data):
        return self._request("POST", "/api/ops/finance/expenses", json=expense_data)

    def list_expenses(self, limit=1000):
        return self._request("GET", "/api/ops/finance/expenses", params={"limit": limit})

    # ---------- Support ----------
    def list_support(self, status=None, limit=200):
        params = {"limit": limit}
        if status:
            params["status"] = status
        return self._request("GET", "/api/ops/support", params=params)

    def create_support_ticket(self, ticket_data):
        return self._request("POST", "/api/ops/support", json=ticket_data)

    def add_support_message(self, ticket_id, body):
        return self._request("POST", f"/api/ops/support/{ticket_id}/messages", json={"body": body})

    # ---------- Social Integrations ----------
    def list_social_integrations(self, limit=1000):
        return self._request("GET", "/api/ops/social/integrations", params={"limit": limit})

    def get_social_integration(self, integration_id):
        return self._request("GET", f"/api/ops/social/integrations/{integration_id}")

    def create_social_integration(self, integration_data):
        return self._request("POST", "/api/ops/social/integrations", json=integration_data)

    def update_social_integration(self, integration_id, patch):
        return self._request("PATCH", f"/api/ops/social/integrations/{integration_id}", json=patch)

    def delete_social_integration(self, integration_id):
        return self._request("DELETE", f"/api/ops/social/integrations/{integration_id}")

    def refresh_integration_token(self, integration_id):
        return self._request("POST", f"/api/ops/social/integrations/{integration_id}/refresh")

    # ---------- Marketing ----------
    def list_campaigns(self, status=None, platform=None, limit=1000):
        params = {"limit": limit}
        if status:
            params["status"] = status
        if platform:
            params["platform"] = platform
        return self._request("GET", "/api/ops/marketing/campaigns", params=params)

    def create_campaign(self, campaign_data):
        return self._request("POST", "/api/ops/marketing/campaigns", json=campaign_data)

    def get_campaign(self, campaign_id):
        return self._request("GET", f"/api/ops/marketing/campaigns/{campaign_id}")

    def update_campaign(self, campaign_id, patch):
        return self._request("PATCH", f"/api/ops/marketing/campaigns/{campaign_id}", json=patch)

    def approve_campaign(self, campaign_id):
        return self._request("POST", f"/api/ops/marketing/campaigns/{campaign_id}/approve")

    def launch_campaign(self, campaign_id):
        return self._request("POST", f"/api/ops/marketing/campaigns/{campaign_id}/launch")

    def list_creatives(self, campaign_id=None):
        params = {}
        if campaign_id:
            params["campaign_id"] = campaign_id
        return self._request("GET", "/api/ops/marketing/creatives", params=params)

    def create_creative(self, creative_data):
        return self._request("POST", "/api/ops/marketing/creatives", json=creative_data)

    def update_creative(self, creative_id, patch):
        return self._request("PATCH", f"/api/ops/marketing/creatives/{creative_id}", json=patch)

    # ---------- Automations ----------
    def list_automations(self, status=None, limit=500):
        params = {"limit": limit}
        if status:
            params["status"] = status
        return self._request("GET", "/api/ops/automations", params=params)

    def create_automation(self, automation_data):
        return self._request("POST", "/api/ops/automations", json=automation_data)

    def get_automation(self, automation_id):
        return self._request("GET", f"/api/ops/automations/{automation_id}")

    def cancel_automation(self, automation_id):
        return self._request("PATCH", f"/api/ops/automations/{automation_id}/cancel")

    def retry_automation(self, automation_id):
        return self._request("POST", f"/api/ops/automations/{automation_id}/retry")

    def delete_automation(self, automation_id):
        return self._request("DELETE", f"/api/ops/automations/{automation_id}")

    def list_automation_logs(self, automation_id, limit=100):
        return self._request("GET", f"/api/ops/automations/{automation_id}", params={"limit": limit})

    # ---------- Websites ----------
    def list_websites(self, status=None, client_id=None, limit=500):
        params = {"limit": limit}
        if status:
            params["status"] = status
        if client_id:
            params["client_id"] = client_id
        return self._request("GET", "/api/ops/websites", params=params)

    def get_website(self, website_id):
        return self._request("GET", f"/api/ops/websites/{website_id}")

    def create_website(self, website_data):
        return self._request("POST", "/api/ops/websites", json=website_data)

    def update_website(self, website_id, patch):
        return self._request("PATCH", f"/api/ops/websites/{website_id}", json=patch)

    def get_website_tasks(self, website_id):
        return self._request("GET", f"/api/ops/websites/{website_id}/tasks")

    def create_website_task(self, website_id, task_data):
        return self._request("POST", f"/api/ops/websites/{website_id}/tasks", json=task_data)

    def update_website_task(self, task_id, patch):
        return self._request("PATCH", f"/api/ops/websites/tasks/{task_id}", json=patch)

    def list_content_approvals(self, client_id=None):
        params = {}
        if client_id:
            params["client_id"] = client_id
        return self._request("GET", "/api/ops/content/approvals", params=params)

    def create_content_approval(self, approval_data):
        return self._request("POST", "/api/ops/content/approvals", json=approval_data)

    def review_content_approval(self, approval_id, decision, feedback=None):
        return self._request("POST", f"/api/ops/content/approvals/{approval_id}/review",
                            json={"decision": decision, "feedback": feedback})

    # ---------- Health ----------
    def health(self):
        return self._request("GET", "/api/health")


# Singleton instance
seai_client = SEAIClient()