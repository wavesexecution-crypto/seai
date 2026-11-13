"""SEAI Automation Engine - Website Research Script (Phase 2 Complete).

Visits a supplied website and extracts:
- Business name, services, description, contact details
- Public social media links
- Page titles and metadata
- Handles inaccessible websites gracefully

Produces structured JSON output.
"""

from scripts.base import ScriptTask, TaskError
from api_client import seai_client
import requests
from bs4 import BeautifulSoup
import re
import urllib.parse

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

SOCIAL_PATTERNS = {
    "facebook": re.compile(r"facebook\.com/[^\s\"'<>]+", re.I),
    "instagram": re.compile(r"instagram\.com/[^\s\"'<>]+", re.I),
    "twitter": re.compile(r"(?:twitter\.com|x\.com)/[^\s\"'<>]+", re.I),
    "linkedin": re.compile(r"linkedin\.com/(?:company|in)/[^\s\"'<>]+", re.I),
    "youtube": re.compile(r"youtube\.com/(?:channel|c|user)/[^\s\"'<>]+", re.I),
    "whatsapp": re.compile(r"whatsapp\.com/[^\s\"'<>]+", re.I),
}


class WebsiteResearchTask(ScriptTask):
    script_name = "website_research"
    task_type = "research"

    def execute(self):
        url = self.input_params.get("url", "")
        extract_contacts = self.input_params.get("extract_contacts", True)
        extract_services = self.input_params.get("extract_services", True)

        if not url:
            raise TaskError("Missing required parameter: url")

        # Normalize URL
        if not url.startswith("http://") and not url.startswith("https://"):
            url = "https://" + url

        self.log("info", f"Researching website: {url}")

        try:
            resp = requests.get(url, headers=HEADERS, timeout=20)
            resp.raise_for_status()
            html = resp.text
            soup = BeautifulSoup(html, "html.parser")

            result = {
                "url": url,
                "status_code": resp.status_code,
                "title": None,
                "description": None,
                "business_name": None,
                "services": [],
                "email": None,
                "phone": None,
                "address": None,
                "social_links": {},
                "error": None,
            }

            # Extract page title
            if soup.title:
                result["title"] = soup.title.get_text(" ", strip=True)

            # Extract meta description
            meta_desc = soup.find("meta", attrs={"name": "description"})
            if meta_desc and meta_desc.get("content"):
                result["description"] = meta_desc["content"].strip()

            # Extract text content
            text = soup.get_text(" ", strip=True)

            # Extract business name (from title or h1)
            h1 = soup.find("h1")
            if h1:
                result["business_name"] = h1.get_text(" ", strip=True)[:200]
            elif result["title"]:
                result["business_name"] = result["title"][:200]

            # Extract contact details
            if extract_contacts:
                emails = re.findall(r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}', html)
                if emails:
                    result["email"] = emails[0]

                phones = re.findall(
                    r'(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}',
                    html,
                )
                if phones:
                    p = phones[0]
                    result["phone"] = p if isinstance(p, str) else (p[-1] if p else None)

                # Address-like text
                address_lines = re.findall(
                    r'.{0,50}(?:street|road|avenue|lane|drive|court|place|nagar|marg|cross).{0,50}',
                    text,
                    re.IGNORECASE,
                )
                if address_lines:
                    result["address"] = address_lines[0].strip()[:200]

            # Extract social media links
            social_links = {}
            for platform, pattern in SOCIAL_PATTERNS.items():
                matches = pattern.findall(html)
                if matches:
                    # Clean up URLs
                    cleaned = []
                    for m in matches:
                        m = m.rstrip(".,);")
                        if m not in cleaned:
                            cleaned.append(m)
                    social_links[platform] = cleaned[:3]
            result["social_links"] = social_links

            # Extract services (heuristic: look for service-related keywords)
            if extract_services:
                service_keywords = [
                    "web design", "web development", "digital marketing",
                    "seo", "social media", "branding", "advertising",
                    "content writing", "graphic design", "app development",
                    "e-commerce", "mobile app", "software development",
                    "consulting", "automation", "lead generation",
                ]
                found_services = []
                text_lower = text.lower()
                for kw in service_keywords:
                    if kw in text_lower and kw not in found_services:
                        found_services.append(kw)
                result["services"] = found_services[:10]

            result["text_length"] = len(text)
            self.log("info", f"Website research complete: {url}")
            return result

        except requests.exceptions.Timeout:
            self.log("warn", f"Website request timed out: {url}")
            return {
                "url": url,
                "error": "Request timed out",
                "status_code": None,
            }
        except requests.exceptions.ConnectionError:
            self.log("warn", f"Connection error: {url}")
            return {
                "url": url,
                "error": "Connection error",
                "status_code": None,
            }
        except requests.exceptions.RequestException as e:
            self.log("warn", f"Website request failed: {url} - {str(e)}")
            return {
                "url": url,
                "error": str(e),
                "status_code": None,
            }
        except Exception as e:
            self.log("error", f"Website research failed: {url} - {str(e)}")
            raise TaskError(str(e))
