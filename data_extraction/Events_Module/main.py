import os
import json
import time
import re
import pandas as pd
from datetime import datetime
from dateutil.relativedelta import relativedelta
from dotenv import load_dotenv
from openai import OpenAI
from geopy.geocoders import Nominatim
from geopy.exc import GeocoderTimedOut, GeocoderServiceError

# Import shared partition resolver
try:
    from partition_utils import get_partition_date
except ImportError:
    from Events_Module.partition_utils import get_partition_date

# ==============================================================================
# ⚙️ CONFIGURATION
# ==============================================================================
S3_BASE = "s3://bitech-pbac-data-prd/event-data/bronze"

PARTITION_DATE = get_partition_date(S3_BASE)
FILE_NATIONWIDE = f"{S3_BASE}/{PARTITION_DATE}/germany_events_nationwide_strict.csv"
FILE_KOLN_ONLY  = f"{S3_BASE}/{PARTITION_DATE}/koln_events_only.csv"

load_dotenv()
API_KEY = os.getenv("PERPLEXITY_API_KEY")
if not API_KEY:
    raise ValueError("Please set PERPLEXITY_API_KEY in your .env file")

MODEL_NAME = "sonar-pro"
client = OpenAI(api_key=API_KEY, base_url="https://api.perplexity.ai")
geolocator = Nominatim(user_agent="bitech_event_aggregator_v1")


def extract_json_from_text(text):
    try:
        match = re.search(r'\{.*\}', text, re.DOTALL)
        if match:
            return match.group(0)
        return text
    except Exception:
        return text


def get_events_from_perplexity(specific_month):
    system_prompt = (
        "You are a high-precision Event Data Extraction Engine for Germany. "
        "Your task is to crawl the web for public events and output data in strict JSON format. "
        "STRICT CONSTRAINTS:\n"
        "1. NO CHAT: Output ONLY JSON.\n"
        "2. LANGUAGE: Event Names must remain in their original language. "
        "   City Names MUST be in German (e.g., use 'Köln' instead of 'Cologne').\n"
        "3. CROWD SIZE: Only include events with expected crowds > 500 people.\n"
        "4. DATES: Use strict YYYY-MM-DD format.\n"
    )
    user_prompt = f"""
    Search for a total of at least 15-20 major events occurring in Germany specifically in {specific_month}.

    PRIORITY INSTRUCTIONS:
    1. FIRST, find ALL available major events in Cologne (Köln).
    2. SECOND, if the total count is less than 15, fill the remaining spots with major events from other German cities.

    REQUIRED JSON SCHEMA:
    {{
      "events": [
        {{
          "event_name": "String",
          "city_name": "String",
          "postal_code": "String",
          "venue_address": "String",
          "start_date": "YYYY-MM-DD",
          "end_date": "YYYY-MM-DD (or null)",
          "expected_crowd": "String or Integer",
          "event_type": "String"
        }}
      ]
    }}
    """
    try:
        response = client.chat.completions.create(
            model=MODEL_NAME,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.2,
        )
        content = response.choices[0].message.content
        if "```" in content:
            content = content.replace("```json", "").replace("```", "")
        content = extract_json_from_text(content)
        return content
    except Exception as e:
        print(f"   [!] API Connection Error: {e}")
        return "{}"


def get_lat_long(postal_code, city, address=""):
    try:
        query = f"{address}, {postal_code} {city}, Germany" if address and postal_code else \
                f"{postal_code} {city}, Germany" if postal_code else f"{city}, Germany"
        location = geolocator.geocode(query, timeout=10)
        if location:
            return location.latitude, location.longitude
        return None, None
    except (GeocoderTimedOut, GeocoderServiceError):
        return None, None


def recalculate_occurrence(start_str, end_str):
    try:
        today = datetime.now().date()
        start_date = datetime.strptime(start_str, "%Y-%m-%d").date()
        end_date = datetime.strptime(end_str, "%Y-%m-%d").date() if end_str and end_str.lower() != "null" else start_date
        if today < start_date: return "upcoming"
        elif today > end_date: return "finished"
        else: return "ongoing"
    except:
        return "Unknown"


def main():
    all_raw_events = []

    current_date_obj = datetime.now()
    start_date_range = current_date_obj - relativedelta(months=5)
    end_date_range   = current_date_obj + relativedelta(months=8)

    dates = pd.date_range(start=start_date_range.replace(day=1), end=end_date_range.replace(day=1), freq='MS')
    months_to_search = [d.strftime("%B %Y") for d in dates]

    print(f"=== Starting S3 Events Search (Köln First) ===")
    print(f"Target Partition: {PARTITION_DATE}")
    print(f"Search Range: {months_to_search[0]} to {months_to_search[-1]}")

    # PHASE 1: SEARCH
    for idx, month in enumerate(months_to_search):
        print(f"[{idx+1}/{len(months_to_search)}] Searching {month}...")
        json_response = get_events_from_perplexity(month)
        try:
            data = json.loads(json_response)
            if "events" in data:
                all_raw_events.extend(data["events"])
        except json.JSONDecodeError:
            print("   -> JSON Parse Fail.")
        time.sleep(1.5)

    if not all_raw_events:
        print("No events found.")
        return

    # PHASE 2: PROCESSING & GEOCODING
    df = pd.DataFrame(all_raw_events)
    df.drop_duplicates(subset=['start_date', 'postal_code', 'city_name'], inplace=True)

    final_events = []
    for event in df.to_dict('records'):
        lat, lon = get_lat_long(event.get("postal_code"), event.get("city_name"), event.get("venue_address"))
        event["latitude"], event["longitude"] = lat, lon
        event["occurrence"] = recalculate_occurrence(event.get("start_date"), event.get("end_date"))
        final_events.append(event)
        time.sleep(1.1)

    # PHASE 3: SAVE TO S3
    df_final = pd.DataFrame(final_events)
    cols = ["event_name", "city_name", "postal_code", "start_date", "end_date",
            "expected_crowd", "event_type", "latitude", "longitude", "occurrence"]
    for c in cols:
        if c not in df_final.columns:
            df_final[c] = None
    df_final = df_final[cols].sort_values(by="start_date")

    df_final.to_csv(FILE_NATIONWIDE, index=False, encoding='utf-8-sig')
    print(f"✅ Saved Nationwide to S3: {FILE_NATIONWIDE}")

    df_koln = df_final[df_final['city_name'].str.contains("Köln|Cologne|Koeln", case=False, na=False)].copy()
    df_koln.to_csv(FILE_KOLN_ONLY, index=False, encoding='utf-8-sig')
    print(f"✅ Saved Köln-Only to S3: {FILE_KOLN_ONLY}")


if __name__ == "__main__":
    main()