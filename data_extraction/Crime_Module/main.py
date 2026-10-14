import pandas as pd
import os
import subprocess
import sys
from datetime import datetime

# Import functions
try:
    from Crime_Module.merge_data import geocode_crime_data
except ImportError as e:
    print(f"❌ Import Error: {e}")
    sys.exit(1)

# Import shared partition resolver
try:
    from partition_utils import get_partition_date
except ImportError:
    from Crime_Module.partition_utils import get_partition_date

# ==============================================================================
# ⚙️ CONFIGURATION (S3 PATHS)
# ==============================================================================
S3_BRONZE_BASE = "s3://bitech-pbac-data-prd/crime-data/bronze"
S3_HELPER_BASE = "s3://bitech-pbac-data-prd/helper-data"

PARTITION_DATE = get_partition_date(S3_BRONZE_BASE)
BRONZE_PARTITION = f"{S3_BRONZE_BASE}/{PARTITION_DATE}"

# --- FIX: Flat path with /crime-data/ subfolder ---
CRIME_RAW_FILE = f"{S3_HELPER_BASE}/crime-data/crime_data_raw_with_plz.csv"

# --- FINAL/BRONZE FILES ---
CRIME_ENHANCED_FILE = f"{BRONZE_PARTITION}/crime_data_with_coords_and_city.csv"

def run_pipeline():
    print("===================================================")
    print("🚀 STARTING CRIME & WEATHER DATA PIPELINE (S3 MODE)")
    print(f"📅 Partition: {PARTITION_DATE}")
    print(f"📦 Target S3 (Bronze): {BRONZE_PARTITION}")
    print(f"📦 Target S3 (Helper Raw): {CRIME_RAW_FILE}")
    print("===================================================")

    # ---------------------------------------------------------
    # STEP 1: SCRAPING
    # ---------------------------------------------------------
    print("\n[STEP 1/2] Scraping Crime Data...")
    try:
        env = os.environ.copy()
        env['CRIME_PARTITION_DATE'] = PARTITION_DATE
        # Pass the flat raw path so the scraper knows to overwrite the root file
        env['CRIME_RAW_FILE_S3'] = CRIME_RAW_FILE 
        
        subprocess.run([sys.executable, "Crime_Module/scraper.py"], check=True, env=env)
    except subprocess.CalledProcessError:
        print("❌ Scraping failed or was cancelled.")
        sys.exit(1)

    # ---------------------------------------------------------
    # STEP 2: GEOCODING
    # ---------------------------------------------------------
    print("\n[STEP 2/2] Geocoding (Mapping PLZ to Coordinates)...")
    try:
        # We pass the flat raw path so the geocoder finds the scraper's output
        geocode_crime_data(
            partition_date=PARTITION_DATE,
            raw_s3_path=CRIME_RAW_FILE
        )
    except Exception as e:
        print(f"❌ Geocoding failed: {e}")
        sys.exit(1)

    print("\n===================================================")
    print("✅ CRIME SCRAPING AND GEOCODING COMPLETE")
    print(f"📍 Final Data Location: {BRONZE_PARTITION}")
    print("===================================================")


if __name__ == "__main__":
    run_pipeline()