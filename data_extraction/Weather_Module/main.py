import pandas as pd
import subprocess
import os
import sys
from datetime import datetime

# Import weather fetching function
try:
    from weather_forecast import fetch_weather_batch
except ImportError as e:
    print(f"❌ Error: Could not import 'weather_forecast.py'.\nDetails: {e}")
    sys.exit(1)

# Import shared partition resolver
try:
    from partition_utils import get_partition_date, get_latest_partition
except ImportError:
    from Weather_Module.partition_utils import get_partition_date, get_latest_partition

current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.append(current_dir)

# ==============================================================================
# ⚙️ CONFIGURATION (S3 PATHS)
# ==============================================================================
# 1. Define base locations
S3_CRIME_BRONZE   = "s3://bitech-pbac-data-prd/crime-data/bronze"
S3_WEATHER_BRONZE = "s3://bitech-pbac-data-prd/weather-data/bronze"
S3_HELPER_BASE    = "s3://bitech-pbac-data-prd/helper-data"

# 2. Resolve partitions
# We read the latest Crime data and create a new partition for Weather
CRIME_PARTITION   = get_latest_partition(S3_CRIME_BRONZE)
WEATHER_PARTITION = get_partition_date(S3_WEATHER_BRONZE)

# 3. Define Full S3 Paths
CRIME_DATA_S3 = f"{S3_CRIME_BRONZE}/{CRIME_PARTITION}/crime_data_with_coords_and_city.csv"

# --- FINAL/BRONZE FILES (Partitioned for Glue) ---
# ✅ SWAPPED: Merged data now goes to Bronze Partition
MERGED_DATA_S3 = f"{S3_WEATHER_BRONZE}/{WEATHER_PARTITION}/crime_and_weather_merged.csv"

# --- HELPER/WORK FILES (FLAT PATHS - No Date Partition) ---
# ✅ SWAPPED: Raw forecast now goes to flat Helper path
WEATHER_OUTPUT_FILE = f"{S3_HELPER_BASE}/weather-data/crime_weather_data_forecast.csv"
POSTAL_FILE_S3      = f"{S3_HELPER_BASE}/weather-data/postal_code_coordinates.csv"

# 4. Local Script Paths
SCRIPT_PLZ   = os.path.join(current_dir, 'plz_to_latlong.py')
SCRIPT_MERGE = os.path.join(current_dir, 'simple_merge.py')

# 5. Environment Setup (Sync paths with sub-scripts)
env = os.environ.copy()
env['CRIME_DATA_S3']       = CRIME_DATA_S3
env['POSTAL_FILE_S3']      = POSTAL_FILE_S3
env['WEATHER_OUTPUT_FILE'] = WEATHER_OUTPUT_FILE
env['MERGED_DATA_S3']      = MERGED_DATA_S3


def run_step_1_geocoding():
    print("\n" + "="*60)
    print(f"📍 STEP 1: Syncing Coordinates to Helper S3")
    print("="*60)
    try:
        subprocess.run([sys.executable, SCRIPT_PLZ], check=True, env=env)
        return True
    except Exception as e:
        print(f"❌ Geocoding Step Failed: {e}")
        return False


def run_step_2_weather():
    print("\n" + "="*60)
    print(f"☁️ STEP 2: Fetching Weather Data to Helper S3")
    print("="*60)
    try:
        df = pd.read_csv(POSTAL_FILE_S3)
        lats  = df['latitude'].tolist()
        longs = df['longitude'].tolist()
        print(f"📡 Processing weather for {len(lats)} unique locations...")

        today = datetime.now().strftime('%Y-%m-%d')
        fetch_weather_batch(
            latitudes=lats,
            longitudes=longs,
            start_date=today,
            end_date=today,
            master_csv=WEATHER_OUTPUT_FILE
        )
        return True
    except Exception as e:
        print(f"❌ Weather Fetch Failed: {e}")
        return False


def run_step_3_merge():
    print("\n" + "="*60)
    print(f"🔗 STEP 3: Merging Final Dataset to Bronze Partition ({WEATHER_PARTITION})")
    print("="*60)
    try:
        subprocess.run([sys.executable, SCRIPT_MERGE], check=True, env=env)
        return True
    except Exception as e:
        print(f"❌ Merge Step Failed: {e}")
        return False


if __name__ == "__main__":
    print(f"📂 Reading crime data from : {CRIME_PARTITION}")
    print(f"📂 Writing final merged data to : {WEATHER_PARTITION}")
    
    if run_step_1_geocoding():
        if run_step_2_weather():
            if run_step_3_merge():
                print(f"\n✨ WEATHER PIPELINE COMPLETE FOR {WEATHER_PARTITION} ✨")
            else:
                sys.exit(1)
        else:
            sys.exit(1)
    else:
        sys.exit(1)