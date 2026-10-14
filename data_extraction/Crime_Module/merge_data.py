import pandas as pd
import requests
import time
import os
from datetime import datetime
from tqdm import tqdm

# ==============================================================================
# ⚙️ CONFIGURATION
# ==============================================================================
S3_BRONZE_BASE = "s3://bitech-pbac-data-prd/crime-data/bronze"

# --- FLAT HELPER PATHS (No Date Partitions) ---
# FIX: Moved into the crime-data subfolder for a cleaner root bucket
DEFAULT_RAW_INPUT = "s3://bitech-pbac-data-prd/helper-data/crime-data/crime_data_raw_with_plz.csv"
CACHE_FILE        = "s3://bitech-pbac-data-prd/helper-data/crime-data/plz_coords_cache.csv"

# ==============================================================================
# 🌍 COORDINATE FETCHER
# ==============================================================================
class CoordinateFetcher:
    def __init__(self):
        self.base_url = "https://nominatim.openstreetmap.org/search"
        self.headers = {'User-Agent': 'CrimeDataProcessor/1.0 (academic_project)'}

    def get_coords(self, postal_code):
        params = {
            'postalcode': postal_code,
            'country': 'Germany',
            'format': 'json',
            'limit': 1,
            'addressdetails': 1
        }
        try:
            response = requests.get(self.base_url, params=params, headers=self.headers)
            if response.status_code == 200:
                data = response.json()
                if data:
                    item = data[0]
                    lat = item.get('lat')
                    lon = item.get('lon')
                    address = item.get('address', {})
                    city_name = (
                        address.get('city') or address.get('town') or
                        address.get('village') or address.get('municipality')
                    )
                    if not city_name:
                        city_name = item.get('display_name', '').split(',')[0]
                    return lat, lon, city_name
        except Exception as e:
            print(f"⚠️ Error fetching {postal_code}: {e}")
        return None, None, None


def geocode_crime_data(partition_date: str = None, raw_s3_path: str = None):
    """
    Geocodes crime data.
    Reads from the FLAT Helper S3 file and writes to the PARTITIONED Bronze S3 folder.
    """
    if partition_date is None:
        try:
            from partition_utils import get_partition_date
        except ImportError:
            from Crime_Module.partition_utils import get_partition_date
        partition_date = get_partition_date(S3_BRONZE_BASE)

    # Use the path passed from main.py, or fall back to the flat default
    INPUT_FILE = raw_s3_path or os.environ.get('CRIME_RAW_FILE_S3', DEFAULT_RAW_INPUT)
    
    # Output always remains partitioned for Bronze/Glue
    OUTPUT_FILE = f"{S3_BRONZE_BASE}/{partition_date}/crime_data_with_coords_and_city.csv"

    print(f"⏳ Loading Raw Crime Data from Helper S3: {INPUT_FILE}")
    try:
        df = pd.read_csv(INPUT_FILE, dtype={'PLZ': str})
    except Exception as e:
        print(f"❌ Error: {INPUT_FILE} not found on S3. {e}")
        raise FileNotFoundError(f"Could not find input file at {INPUT_FILE}")

    df['PLZ'] = df['PLZ'].str.strip()
    valid_plz_mask = df['PLZ'].str.isnumeric() == True
    unique_plzs = df[valid_plz_mask]['PLZ'].unique()
    print(f"   -> Found {len(unique_plzs)} unique Postal Codes to geocode.")

    # --- S3 CACHING SYSTEM ---
    try:
        cache_df = pd.read_csv(CACHE_FILE, dtype={'PLZ': str})
        if 'City_name' not in cache_df.columns:
            cache_df['City_name'] = None
        print(f"   -> Loaded {len(cache_df)} cached coordinates from Helper S3.")
    except:
        print("   -> No existing cache found on Helper S3. Creating new one.")
        cache_df = pd.DataFrame(columns=['PLZ', 'latitude', 'longitude', 'City_name'])

    cached_plzs = set(cache_df['PLZ'])
    missing_plzs = [p for p in unique_plzs if p not in cached_plzs]

    if missing_plzs:
        print(f"🌍 Fetching data for {len(missing_plzs)} new PLZs...")
        fetcher = CoordinateFetcher()
        new_data = []
        for plz in tqdm(missing_plzs):
            lat, lon, city = fetcher.get_coords(plz)
            if lat and lon:
                new_data.append({'PLZ': plz, 'latitude': lat, 'longitude': lon, 'City_name': city})
            time.sleep(1.1)

        if new_data:
            new_df = pd.DataFrame(new_data)
            cache_df = pd.concat([cache_df, new_df], ignore_index=True)
            cache_df.to_csv(CACHE_FILE, index=False)
            print(f"✅ Updated GLOBAL Helper S3 cache with {len(new_df)} new locations.")
    else:
        print("✅ All PLZs found in cache. No API calls needed.")

    print(f"🔗 Merging coordinates and saving to Bronze partition: {partition_date}")
    enhanced_df = pd.merge(df, cache_df, on='PLZ', how='left')
    
    # Save to Bronze
    enhanced_df.to_csv(OUTPUT_FILE, index=False, encoding='utf-8-sig')

    matched = enhanced_df.dropna(subset=['latitude'])
    print(f"💾 Saved Enhanced Data to Bronze S3: {OUTPUT_FILE}")
    print(f"📊 Stats: {len(matched)} / {len(df)} records successfully geocoded.")


if __name__ == "__main__":
    geocode_crime_data()