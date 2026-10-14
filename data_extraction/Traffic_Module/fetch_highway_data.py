import requests
import pandas as pd
import time
import os
from geopy.geocoders import Nominatim
from geopy.extra.rate_limiter import RateLimiter

BASE_URL = "https://verkehr.autobahn.de/o/autobahn"
CACHE_FILE = "s3://bitech-pbac-data-prd/helper-data/traffic-data/traffic_geocode_cache.csv"

# ==============================================================================
# 🌍 GEOCODER INITIALIZATION
# ==============================================================================
geolocator = Nominatim(user_agent="bitech_highway_pipeline_aws", timeout=10)
geocode = RateLimiter(geolocator.reverse, min_delay_seconds=1.0)

# ==============================================================================
# 🗄️ CACHE MANAGEMENT
# ==============================================================================
def load_cache():
    try:
        df = pd.read_csv(CACHE_FILE)
        # Create a fast lookup dictionary using rounded coordinates
        # Rounding to 4 decimal places gives ~11m accuracy, perfect for highways
        cache_dict = {}
        for _, row in df.iterrows():
            key = f"{round(float(row['lat']), 4)}_{round(float(row['lon']), 4)}"
            cache_dict[key] = (row['city'], row['postal_code'])
        print(f"   -> 🗄️ Loaded {len(cache_dict)} cached locations from S3.")
        return cache_dict
    except:
        print("   -> 🗄️ No existing cache found on S3. Creating new one.")
        return {}

def save_cache(new_entries):
    if not new_entries:
        return
    new_df = pd.DataFrame(new_entries)
    try:
        existing_df = pd.read_csv(CACHE_FILE)
        final_df = pd.concat([existing_df, new_df]).drop_duplicates(subset=['lat', 'lon'])
    except:
        final_df = new_df
        
    final_df.to_csv(CACHE_FILE, index=False)
    print(f"   -> 💾 Saved {len(new_entries)} new locations to S3 Cache.")

# ==============================================================================
# 🚦 CORE LOGIC
# ==============================================================================
def fetch_data(highway_id, endpoint_type):
    url = f"{BASE_URL}/{highway_id}/services/{endpoint_type}"
    print(f"   -> Fetching {endpoint_type} data for {highway_id}...")
    try:
        response = requests.get(url, timeout=15)
        if response.status_code == 404:
            print(f"      ⚠️ API returned 404 for {endpoint_type}. Moving on...")
            return []
        response.raise_for_status()
        data = response.json()
        return data.get(endpoint_type, [])
    except Exception as e:
        print(f"      ❌ Error fetching {endpoint_type}: {e}")
        return []

def get_location_details(lat, long):
    if not lat or not long:
        return "Unknown", "Unknown"
    try:
        location = geocode((lat, long), language='en')
        if location:
            address = location.raw.get('address', {})
            city = address.get('city') or address.get('town') or address.get('village') or "Unknown"
            zipcode = address.get('postcode', "Unknown")
            return city, zipcode
    except Exception:
        pass
    return "Unknown", "Unknown"

def process_records(items_list, source_type, highway_id, global_cache, new_cache_entries):
    processed_rows = []
    total = len(items_list)
    if total == 0: 
        return processed_rows

    print(f"   -> Processing {total} {source_type} records for {highway_id}...")

    for index, item in enumerate(items_list):
        coord = item.get('coordinate', {})
        lat = coord.get('lat')
        lon = coord.get('long')

        if not lat or not lon:
            geom = item.get('geometry', {})
            coords_list = geom.get('coordinates', [])
            if coords_list and len(coords_list) > 0:
                lon = coords_list[0][0]
                lat = coords_list[0][1]

        city, postal_code = "Unknown", "Unknown"

        if lat and lon:
            # 1. Check Cache First
            cache_key = f"{round(float(lat), 4)}_{round(float(lon), 4)}"
            
            if cache_key in global_cache:
                city, postal_code = global_cache[cache_key]
            else:
                # 2. If not in cache, fetch from API
                print(f"      🌍 API Call needed for new location {index + 1}/{total}...", end='\r')
                city, postal_code = get_location_details(lat, lon)
                
                # Update our live dictionaries
                global_cache[cache_key] = (city, postal_code)
                new_cache_entries.append({
                    'lat': round(float(lat), 4), 
                    'lon': round(float(lon), 4), 
                    'city': city, 
                    'postal_code': postal_code
                })

        desc_raw = item.get('description', [])
        description_text = " | ".join(desc_raw) if isinstance(desc_raw, list) else str(desc_raw)

        record = {
            'Latitude': lat,
            'Longitude': lon,
            'city_name': city,             
            'postal_code': postal_code,    
            'identifier': item.get('identifier'),
            'isBlocked': item.get('isBlocked'),
            'display_type': item.get('display_type'),
            'startTimestamp': item.get('startTimestamp'), 
            'delayTimeValue': item.get('delayTimeValue', 0),
            'abnormalTrafficType': item.get('abnormalTrafficType', 'N/A'),
            'averageSpeed': item.get('averageSpeed', 0),
            'future': item.get('future'),
            'description': description_text,
            'source': source_type,
            'highway': highway_id
        }
        processed_rows.append(record)
        
    print(f"\n   -> Finished processing {source_type}.")
    return processed_rows