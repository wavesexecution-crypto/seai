"""SEAI Deterministic Automation Engine - Configuration."""
import os
from dotenv import load_dotenv

load_dotenv()

# Neon PostgreSQL
DATABASE_URL = os.getenv("DATABASE_URL", "")

# SEAI Backend API
SEAI_API_BASE = os.getenv("SEAI_API_BASE", "http://localhost:3000")
SEAI_API_KEY = os.getenv("SEAI_API_KEY", "")

# n8n
N8N_BASE_URL = os.getenv("N8N_BASE_URL", "http://localhost:5678")
N8N_API_KEY = os.getenv("N8N_API_KEY", "")

# Automation engine settings
WORKER_POLL_INTERVAL_SECONDS = int(os.getenv("WORKER_POLL_INTERVAL_SECONDS", "5"))
TASK_TIMEOUT_SECONDS = int(os.getenv("TASK_TIMEOUT_SECONDS", "300"))
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "3"))

# Operator credentials for SEAI backend session auth
SEAI_OPS_EMAIL = os.getenv("SEAI_OPS_EMAIL", "")
SEAI_OPS_PASSWORD = os.getenv("SEAI_OPS_PASSWORD", "")

# Encryption key for credentials at rest
ENCRYPTION_KEY = os.getenv("SEAI_ENCRYPTION_KEY", "")

# Logging
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
LOG_DIR = os.path.join(os.path.dirname(__file__), "logs")

# Playwright
PLAYWRIGHT_BROWSER = os.getenv("PLAYWRIGHT_BROWSER", "chromium")
PLAYWRIGHT_HEADLESS = os.getenv("PLAYWRIGHT_HEADLESS", "true").lower() == "true"

# Validate required config
if not DATABASE_URL:
    raise ValueError("DATABASE_URL is required in environment")
