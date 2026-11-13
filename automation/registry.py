"""SEAI Automation Engine - Task Registry.

Maps script names to their Python module entry points. Only registered
scripts can be executed - no arbitrary code execution.
"""

# Registry: script_name -> {module, class, task_type, description, input_schema}
TASK_REGISTRY = {
    "lead_research": {
        "module": "scripts.lead_research",
        "class": "LeadResearchTask",
        "task_type": "research",
        "description": "Research businesses from public sources, validate contacts, and save leads to CRM.",
        "input_schema": {
            "required": ["query", "location"],
            "optional": ["industry", "max_results", "save_to_crm"],
            "types": {
                "query": str,
                "location": str,
                "industry": str,
                "max_results": int,
                "save_to_crm": bool,
            },
        },
    },
    "website_research": {
        "module": "scripts.website_research",
        "class": "WebsiteResearchTask",
        "task_type": "research",
        "description": "Visit a website and extract structured business information.",
        "input_schema": {
            "required": ["url"],
            "optional": ["extract_contacts", "extract_services"],
            "types": {
                "url": str,
                "extract_contacts": bool,
                "extract_services": bool,
            },
        },
    },
    "competitor_monitor": {
        "module": "scripts.competitor_monitor",
        "class": "CompetitorMonitorTask",
        "task_type": "monitor",
        "description": "Monitor competitor websites for changes and store snapshots.",
        "input_schema": {
            "required": ["urls"],
            "optional": ["check_interval_hours"],
            "types": {
                "urls": list,
                "check_interval_hours": int,
            },
        },
    },
    "crm_automation": {
        "module": "scripts.crm_automation",
        "class": "CRMAutomationTask",
        "task_type": "crm",
        "description": "Import, deduplicate, and update lead statuses based on rules.",
        "input_schema": {
            "required": [],
            "optional": ["action", "source", "days_since_contact"],
            "types": {
                "action": str,
                "source": str,
                "days_since_contact": int,
            },
        },
    },
    "social_media": {
        "module": "scripts.social_media",
        "class": "SocialMediaTask",
        "task_type": "social",
        "description": "Retrieve analytics, publishing history, and prepare content (publish requires approval).",
        "input_schema": {
            "required": ["platform", "action"],
            "optional": ["account_id", "content", "schedule_at", "approve_publish"],
            "types": {
                "platform": str,
                "action": str,
                "account_id": str,
                "content": str,
                "schedule_at": str,
                "approve_publish": bool,
            },
        },
    },
    "business_monitor": {
        "module": "scripts.business_monitor",
        "class": "BusinessMonitorTask",
        "task_type": "monitor",
        "description": "Check website/API health, detect failed executions, report overdue items.",
        "input_schema": {
            "required": [],
            "optional": ["check_websites", "check_apis", "overdue_days"],
            "types": {
                "check_websites": list,
                "check_apis": list,
                "overdue_days": int,
            },
        },
    },
}


def get_task_definition(script_name):
    """Get the task definition for a script name. Returns None if not registered."""
    return TASK_REGISTRY.get(script_name)


def list_registered_tasks():
    """List all registered task definitions."""
    return TASK_REGISTRY


def is_registered(script_name):
    """Check if a script name is registered."""
    return script_name in TASK_REGISTRY


def validate_input(script_name, input_params):
    """Validate input parameters against the task's schema.
    Returns (is_valid, error_message)."""
    definition = get_task_definition(script_name)
    if not definition:
        return False, f"Script '{script_name}' is not registered"

    schema = definition.get("input_schema", {})
    required = schema.get("required", [])
    types = schema.get("types", {})

    # Check required fields
    for field in required:
        if field not in input_params or input_params[field] is None:
            return False, f"Required field '{field}' is missing"

    # Check types
    for field, expected_type in types.items():
        if field in input_params and input_params[field] is not None:
            actual = input_params[field]
            if expected_type == str and not isinstance(actual, str):
                return False, f"Field '{field}' must be a string"
            if expected_type == int and not isinstance(actual, int):
                return False, f"Field '{field}' must be an integer"
            if expected_type == bool and not isinstance(actual, bool):
                return False, f"Field '{field}' must be a boolean"
            if expected_type == list and not isinstance(actual, list):
                return False, f"Field '{field}' must be a list"

    return True, None
