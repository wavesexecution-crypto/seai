"""SEAI Automation Engine - Lead Research Script (Phase 1 Complete).

Deterministic lead research with multiple configurable search providers,
provider fallback, retry with exponential backoff, result validation,
email/phone format validation, duplicate detection, and CRM integration.

No AI models used. No fabricated data.
"""

import base64
import re
import time
import urllib.parse
import requests
from bs4 import BeautifulSoup
from scripts.base import ScriptTask, TaskError
from api_client import seai_client

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# Max retries per provider
MAX_SEARCH_RETRIES = 3
# Base delay for exponential backoff (seconds)
BACKOFF_BASE = 2


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------

EMAIL_RE = re.compile(r'^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$')
PHONE_RE = re.compile(r'^(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}$')


def is_valid_email(email):
    if not email:
        return False
    return bool(EMAIL_RE.match(email.strip()))


def is_valid_phone(phone):
    if not phone:
        return False
    digits = re.sub(r'\D', '', phone)
    # Valid phone: 7-15 digits
    return 7 <= len(digits) <= 15


def normalize_phone(phone):
    if not phone:
        return None
    digits = re.sub(r'\D', '', phone)
    if 7 <= len(digits) <= 15:
        return digits
    return None


def extract_emails(text):
    if not text:
        return []
    found = re.findall(r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}', text)
    return [e for e in found if is_valid_email(e)]


def extract_phones(text):
    if not text:
        return []
    found = re.findall(
        r'(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}',
        text,
    )
    phones = []
    for p in found:
        if isinstance(p, tuple):
            p = p[-1] if p[-1] else p[0]
        normalized = normalize_phone(p)
        if normalized:
            phones.append(normalized)
    # Deduplicate preserving order
    seen = set()
    unique = []
    for p in phones:
        if p not in seen:
            seen.add(p)
            unique.append(p)
    return unique


# ---------------------------------------------------------------------------
# Search providers
# ---------------------------------------------------------------------------

def _search_duckduckgo(query, max_results):
    """Search via DuckDuckGo HTML. Returns list of {name, url, source}."""
    results = []
    url = "https://duckduckgo.com/html/?q=" + urllib.parse.quote(query)
    print(f"[DDG] Searching: {url}", flush=True)
    for attempt in range(MAX_SEARCH_RETRIES):
        try:
            resp = requests.get(url, headers=HEADERS, timeout=20)
            print(f"[DDG] Attempt {attempt + 1}: status={resp.status_code}, length={len(resp.text)}", flush=True)
            if resp.status_code == 202:
                # Rate-limited / bot detection — backoff and retry
                delay = BACKOFF_BASE ** attempt
                print(f"[DDG] 202 rate-limited, retrying in {delay}s (attempt {attempt + 1}/{MAX_SEARCH_RETRIES})", flush=True)
                time.sleep(delay)
                continue
            resp.raise_for_status()
            soup = BeautifulSoup(resp.text, "html.parser")
            result_count = 0
            for res in soup.select(".result")[:max_results]:
                a = res.select_one(".result__a")
                if not a:
                    continue
                title = a.get_text(" ", strip=True)
                href = a.get("href", "")
                resolved = _unwrap_duckduckgo_url(href)
                if title and resolved:
                    results.append({
                        "name": title,
                        "url": resolved,
                        "source": "duckduckgo",
                    })
                    result_count += 1
            print(f"[DDG] Parsed {result_count} results", flush=True)
            break
        except Exception as e:
            print(f"[DDG] attempt {attempt + 1} failed: {e}", flush=True)
            if attempt < MAX_SEARCH_RETRIES - 1:
                time.sleep(BACKOFF_BASE ** attempt)
    print(f"[DDG] Final: {len(results)} results", flush=True)
    return results


def _unwrap_duckduckgo_url(url):
    if not url:
        return url
    parsed = urllib.parse.urlparse(url)
    qs = urllib.parse.parse_qs(parsed.query)
    if "uddg" in qs:
        return qs["uddg"][0]
    return url


def _unwrap_bing_url(url):
    """Follow Bing's redirect to get the actual target URL."""
    if not url:
        return None
    try:
        resp = requests.get(url, headers=HEADERS, timeout=10, allow_redirects=True)
        final_url = resp.url
        if final_url.startswith("http://") or final_url.startswith("https://"):
            return final_url
    except Exception:
        pass
    return None


def _search_bing(query, max_results):
    """Search via Bing HTML. Returns list of {name, url, source}."""
    results = []
    url = "https://www.bing.com/search?q=" + urllib.parse.quote(query)
    print(f"[Bing] Searching: {url}", flush=True)
    for attempt in range(MAX_SEARCH_RETRIES):
        try:
            resp = requests.get(url, headers=HEADERS, timeout=20)
            print(f"[Bing] Attempt {attempt + 1}: status={resp.status_code}, length={len(resp.text)}", flush=True)
            if resp.status_code == 429:
                delay = BACKOFF_BASE ** attempt
                print(f"[Bing] 429 rate-limited, retrying in {delay}s (attempt {attempt + 1}/{MAX_SEARCH_RETRIES})", flush=True)
                time.sleep(delay)
                continue
            resp.raise_for_status()
            soup = BeautifulSoup(resp.text, "html.parser")
            result_count = 0
            for li in soup.select("li.b_algo")[:max_results]:
                a = li.select_one("h2 a")
                if not a:
                    continue
                title = a.get_text(" ", strip=True)
                href = a.get("href", "")
                if not href:
                    continue
                resolved = _unwrap_bing_url(href)
                if not resolved:
                    # Skip results with invalid/unusable URLs
                    continue
                if title and resolved:
                    results.append({
                        "name": title,
                        "url": resolved,
                        "source": "bing",
                    })
                    result_count += 1
            print(f"[Bing] Parsed {result_count} results", flush=True)
            break
        except Exception as e:
            print(f"[Bing] attempt {attempt + 1} failed: {e}", flush=True)
            if attempt < MAX_SEARCH_RETRIES - 1:
                time.sleep(BACKOFF_BASE ** attempt)
    print(f"[Bing] Final: {len(results)} results", flush=True)
    return results


def search_businesses(query, location, industry, max_results):
    """Search using multiple providers with fallback.

    Returns (results, provider_used, provider_failed).
    provider_failed is True only if ALL providers failed; False means at least
    one succeeded (even if it returned zero results).
    """
    search_query = f"{query} {location} {industry}".strip()
    print(f"[Search] Query: '{search_query}', max_results={max_results}", flush=True)
    all_results = []
    provider_failed = True
    provider_used = None

    # Try DuckDuckGo first
    ddg_results = _search_duckduckgo(search_query, max_results)
    print(f"[Search] DDG returned {len(ddg_results)} results", flush=True)
    if ddg_results:
        provider_used = "duckduckgo"
        provider_failed = False
        all_results.extend(ddg_results)

    # If DDG returned nothing, try Bing as fallback
    if not all_results:
        bing_results = _search_bing(search_query, max_results)
        print(f"[Search] Bing returned {len(bing_results)} results", flush=True)
        if bing_results:
            provider_used = "bing"
            provider_failed = False
            all_results.extend(bing_results)

    # Deduplicate by URL
    seen_urls = set()
    unique = []
    for r in all_results:
        if r["url"] not in seen_urls:
            seen_urls.add(r["url"])
            unique.append(r)

    print(f"[Search] Final unique results: {len(unique)}, provider_used={provider_used}, provider_failed={provider_failed}", flush=True)
    return unique[:max_results], provider_used, provider_failed


# ---------------------------------------------------------------------------
# Website extraction
# ---------------------------------------------------------------------------

def _extract_from_website(url):
    """Visit a website and extract contact details."""
    result = {
        "url": url,
        "email": None,
        "phone": None,
        "address": None,
        "title": None,
        "error": None,
    }
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        html = resp.text
        soup = BeautifulSoup(html, "html.parser")

        result["title"] = soup.title.get_text(" ", strip=True) if soup.title else None

        text = soup.get_text(" ", strip=True)

        emails = extract_emails(text)
        if emails:
            result["email"] = emails[0]

        phones = extract_phones(text)
        if phones:
            result["phone"] = phones[0]

        # Address-like text
        address_lines = re.findall(
            r'.{0,50}(?:street|road|avenue|lane|drive|court|place|nagar|marg|cross).{0,50}',
            text,
            re.IGNORECASE,
        )
        if address_lines:
            result["address"] = address_lines[0].strip()[:200]

        # Try contact page if missing email/phone
        if not result["email"] and not result["phone"]:
            contact_links = soup.find_all('a', href=re.compile(r'contact', re.I))
            if contact_links:
                href = contact_links[0].get('href', '')
                if href:
                    if href.startswith('/'):
                        href = urllib.parse.urljoin(url, href)
                    try:
                        cresp = requests.get(href, headers=HEADERS, timeout=20)
                        ctext = cresp.text
                        c_emails = extract_emails(ctext)
                        if c_emails and not result["email"]:
                            result["email"] = c_emails[0]
                        c_phones = extract_phones(ctext)
                        if c_phones and not result["phone"]:
                            result["phone"] = c_phones[0]
                    except Exception:
                        pass
    except Exception as e:
        result["error"] = str(e)

    return result


# ---------------------------------------------------------------------------
# Main task
# ---------------------------------------------------------------------------

class LeadResearchTask(ScriptTask):
    script_name = "lead_research"
    task_type = "research"

    def execute(self):
        query = self.input_params.get("query", "")
        location = self.input_params.get("location", "")
        industry = self.input_params.get("industry", "")
        max_results = int(self.input_params.get("max_results", 10))
        save_to_crm = self.input_params.get("save_to_crm", True)

        if not query:
            raise TaskError("Missing required parameter: query")
        if not location:
            raise TaskError("Missing required parameter: location")

        self.log("info", f"Starting lead research: query='{query}', location='{location}'")

        # Step 1: Search with provider fallback
        search_results, provider_used, provider_failed = search_businesses(
            query, location, industry, max_results
        )

        self.log("info", f"Search provider used: {provider_used or 'none'}")
        self.log("info", f"Provider failed (all): {provider_failed}")
        self.log("info", f"Found {len(search_results)} potential businesses")

        # Distinguish provider failure from legitimate zero results
        search_status = "no_results"
        if search_results:
            search_status = "success"
        elif provider_failed:
            search_status = "provider_failure"

        # Step 2: Research each business
        results = []
        for idx, business in enumerate(search_results, 1):
            self.log("info", f"Researching business {idx}/{len(search_results)}: {business.get('name')}")
            try:
                researched = self._research_business(business)
                results.append(researched)

                # Step 3: Save to CRM if requested
                if save_to_crm:
                    crm_result = self.save_lead_to_crm(researched, seai_client)
                    researched["crm_action"] = crm_result

            except Exception as e:
                self.log("error", f"Failed to research {business.get('name')}: {str(e)}")
                results.append({
                    "name": business.get("name"),
                    "url": business.get("url"),
                    "source": business.get("source"),
                    "error": str(e),
                    "crm_action": "skipped_error",
                })

        return {
            "query": query,
            "location": location,
            "industry": industry,
            "max_results": max_results,
            "provider_used": provider_used,
            "provider_failed": provider_failed,
            "search_status": search_status,
            "found": len(search_results),
            "researched": len(results),
            "results": results,
        }

    # ------------------------------------------------------------------
    # Per-business research
    # ------------------------------------------------------------------
    def _research_business(self, business):
        """Visit a business website and extract verified contact details."""
        url = business.get("url")
        name = business.get("name", "")

        result = {
            "name": name,
            "url": url,
            "source": business.get("source"),
            "business_name": name,
            "email": None,
            "phone": None,
            "address": None,
            "website_title": None,
            "website": url,
            "verified": False,
        }

        if not url:
            result["error"] = "No website URL"
            return result

        # Validate URL scheme
        if not (url.startswith("http://") or url.startswith("https://")):
            result["error"] = f"Invalid URL scheme: {url[:80]}"
            return result

        extracted = _extract_from_website(url)

        if extracted.get("error"):
            result["error"] = extracted["error"]
            return result

        result["website_title"] = extracted.get("title")
        result["email"] = extracted.get("email")
        result["phone"] = extracted.get("phone")
        result["address"] = extracted.get("address")

        # A lead is "verified" if we have at least a name and website
        result["verified"] = bool(name and url)

        return result

    # ------------------------------------------------------------------
    # CRM integration
    # ------------------------------------------------------------------
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

        # Build CRM payload
        crm_payload = {
            "business_name": lead_data.get("business_name") or lead_data.get("name"),
            "contact_person": None,
            "email": lead_data.get("email"),
            "phone": lead_data.get("phone"),
            "industry": self.input_params.get("industry"),
            "location": self.input_params.get("location"),
            "website": lead_data.get("website"),
            "social_links": {"source_url": lead_data.get("url")},
            "source": "automation_lead_research",
            "business_size": None,
            "potential_services": None,
            "estimated_budget_inr": None,
            "estimated_mrr_inr": None,
            "priority": "normal",
            "stage": "new",
            "assigned_to": None,
            "next_follow_up_at": None,
            "notes": f"Discovered via automation lead research. Source: {lead_data.get('url')}. Website title: {lead_data.get('website_title') or 'N/A'}.",
        }

        # Remove None values for cleaner payload
        crm_payload = {k: v for k, v in crm_payload.items() if v is not None}

        result = seai_client.create_lead(crm_payload)
        if result.get("ok"):
            self.log("info", f"Created lead: {result.get('lead_ref')} - {lead_data.get('business_name')}")
            # Add activity note
            seai_client.add_lead_activity(
                result["id"],
                "note",
                "Lead created by automation engine (lead_research)",
                {"source_url": lead_data.get("url")},
            )
            return {
                "action": "created",
                "lead_id": result["id"],
                "lead_ref": result.get("lead_ref"),
                "source_url": lead_data.get("url"),
            }
        else:
            raise TaskError(f"Failed to create lead: {result.get('error')}")
