import os
import pandas as pd
import time
import sys
from datetime import datetime
from fetch_traffic_data import extract_traffic_data
from fetch_highway_data import fetch_data, process_records

# Import shared partition resolver
try:
    from partition_utils import get_partition_date
except ImportError:
    from Traffic_Module.partition_utils import get_partition_date

# ==============================================================================
# ⚙️ CONFIGURATION (S3 PATHS)
# ==============================================================================
# 1. Define base locations
S3_BRONZE_BASE = "s3://bitech-pbac-data-prd/traffic-data/bronze"
S3_HELPER_BASE = "s3://bitech-pbac-data-prd/helper-data"

# 2. Resolve the correct partition folder (based on the Bronze path)
PARTITION_DATE = get_partition_date(S3_BRONZE_BASE)

# 3. Create full partition paths
# --- FINAL/BRONZE FILES (PARTITIONED - Glue WILL read these) ---
BRONZE_PARTITION = f"{S3_BRONZE_BASE}/{PARTITION_DATE}"

# --- HELPER/WORK FILES (FLAT PATH - Overwrites daily in root helper folder) ---
# FIX: No date partition here to keep the helper-data bucket clean
HELPER_TRAFFIC_DIR = f"{S3_HELPER_BASE}/traffic-data"
COLOGNE_TRAFFIC_FILE = f"{HELPER_TRAFFIC_DIR}/cologne_traffic_data_exploded.csv"


def run_cologne_traffic():
    print("\n--- Phase 1: Cologne Traffic Data ---")
    df = extract_traffic_data()
    if not df.empty:
        # 📂 Saving to the FLAT Helper path
        df.to_csv(COLOGNE_TRAFFIC_FILE, index=False)
        print(f"✅ Saved Cologne data to S3 (Helper): {COLOGNE_TRAFFIC_FILE}")
    else:
        print("❌ No Cologne data extracted.")


def run_highway_traffic():
    print("\n--- Phase 2: German Highway Data ---")
    highways_to_process = ["A1", "A3"]
    
    # NEW: Load the cache once before processing highways
    from fetch_highway_data import load_cache, save_cache
    global_cache = load_cache()
    new_cache_entries = []

    for selected_highway in highways_to_process:
        print(f"\n🚀 Processing Highway: {selected_highway}")
        all_data = []

        warnings  = fetch_data(selected_highway, "warning")
        # NEW: Pass cache variables
        all_data.extend(process_records(warnings, "warning", selected_highway, global_cache, new_cache_entries))

        roadworks = fetch_data(selected_highway, "roadworks")
        # NEW: Pass cache variables
        all_data.extend(process_records(roadworks, "roadworks", selected_highway, global_cache, new_cache_entries))

        if all_data:
            df = pd.DataFrame(all_data)
            if 'startTimestamp' in df.columns:
                df[['start_date', 'start_time']] = df['startTimestamp'].str.extract(r'(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})')

            cols = [
                'highway', 'identifier', 'source', 'display_type', 'isBlocked',
                'delayTimeValue', 'averageSpeed', 'abnormalTrafficType', 'future',
                'description', 'Latitude', 'Longitude', 'city_name', 'postal_code',
                'start_date', 'start_time'
            ]
            final_cols = [c for c in cols if c in df.columns]
            df = df[final_cols]

            filename = f"{BRONZE_PARTITION}/{selected_highway}_highway_data.csv"
            df.to_csv(filename, index=False)
            print(f"✅ Saved Highway data to S3 (Bronze): {filename}")
        else:
            print(f"❌ No data found for {selected_highway}.")

        time.sleep(1)
        
    # NEW: Save any new locations found during this run
    save_cache(new_cache_entries)

def main():
    print("===================================================")
    print("🚀 STARTING TRAFFIC DATA PIPELINE (S3 MODE)")
    print(f"📅 Partition: {PARTITION_DATE}")
    print(f"📦 Target S3 (Bronze): {BRONZE_PARTITION}")
    print(f"📦 Target S3 (Helper): {HELPER_TRAFFIC_DIR}")
    print("===================================================")
    
    run_cologne_traffic()
    run_highway_traffic()
    
    print(f"\n--- All traffic tasks for {PARTITION_DATE} completed successfully ---")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"❌ Traffic Module Failed: {e}")
        sys.exit(1)