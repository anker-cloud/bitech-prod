import pandas as pd
import os
from scipy.spatial import cKDTree

def extract_city(display_name):
    try:
        parts = str(display_name).split(',')
        if len(parts) > 3:
            return parts[3].strip()
    except:
        pass
    return "Unknown"

def nearest_neighbor_merge(df_target, df_source):
    # Setup coordinates for KDTree
    source_coords = df_source[['latitude', 'longitude']].values
    tree = cKDTree(source_coords)
    
    target_coords = df_target[['latitude', 'longitude']].values
    
    # Query nearest point
    dist, idx = tree.query(target_coords, k=1)
    
    # Retrieve match and assign
    matched_postal = df_source.iloc[idx].reset_index(drop=True)
    df_target['postal_code'] = matched_postal['postal_code']
    df_target['city_name'] = matched_postal['city_name']
    
    return df_target

if __name__ == "__main__":
    print("🔗 Starting Merge Process (Enforcing Strict Schema)...")
    
    # Pull S3 paths populated by main.py
    POSTAL_FILE = os.environ.get('POSTAL_FILE_S3')
    WEATHER_FILE = os.environ.get('WEATHER_OUTPUT_FILE')
    OUTPUT_FILE = os.environ.get('MERGED_DATA_S3')

    if not all([POSTAL_FILE, WEATHER_FILE, OUTPUT_FILE]):
        print("❌ Error: Missing S3 environment variables for merge.")
        exit(1)

    print(f"-> Loading Postal Data: {POSTAL_FILE}")
    df_postal = pd.read_csv(POSTAL_FILE)
    
    print(f"-> Loading Weather Data: {WEATHER_FILE}")
    df_weather = pd.read_csv(WEATHER_FILE)

    # 1. Standardize City Name & Postal Code Columns
    # Since the data comes from the Crime module, it might use 'City_name' and 'PLZ'
    if 'city_name' not in df_postal.columns:
        if 'City_name' in df_postal.columns:
            df_postal['city_name'] = df_postal['City_name']
        elif 'display_name' in df_postal.columns:
            df_postal['city_name'] = df_postal['display_name'].apply(extract_city)
        else:
            df_postal['city_name'] = "Unknown"
            
    if 'postal_code' not in df_postal.columns:
        if 'PLZ' in df_postal.columns:
            df_postal['postal_code'] = df_postal['PLZ']
        else:
            df_postal['postal_code'] = "Unknown"

    # 2. Merge Nearest Neighbor
    df_final = nearest_neighbor_merge(df_weather, df_postal)

    # 3. ENFORCE STRICT SCHEMA ORDER 
    cols = [
        'date', 'city_name', 'postal_code', 'latitude', 'longitude',
        'temperature_2m', 'weather_code', 'pressure_msl', 'visibility',
        'wind_speed_10m', 'precipitation', 'cloud_cover', 'snow_depth',
        'surface_pressure', 'temperature_80m', 'soil_temperature_0cm',
        'soil_moisture_0_to_1cm'
    ]
    
    # Filter only available columns (prevents crashes)
    final_cols = [c for c in cols if c in df_final.columns]
    df_final = df_final[final_cols]

    # 4. Save Output
    df_final.to_csv(OUTPUT_FILE, index=False)
    print(f"✅ SUCCESS: Formatted Weather Data saved to: {OUTPUT_FILE}")