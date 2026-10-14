import openmeteo_requests
import pandas as pd
import requests_cache
from retry_requests import retry
import os
import time

def fetch_weather_batch(latitudes, longitudes, start_date, end_date, master_csv):
    """
    Fetches hourly historical/forecast weather data in batches.
    Extracts the exact 12 hourly variables requested for the schema.
    """
    
    # Setup API Client with caching (safely stored in /tmp for AWS Lambda)
    cache_dir = '/tmp/weather_cache'
    cache_session = requests_cache.CachedSession(cache_dir, expire_after=3600)
    retry_session = retry(cache_session, retries=5, backoff_factor=0.2)
    openmeteo = openmeteo_requests.Client(session=retry_session)
    
    url = "https://api.open-meteo.com/v1/forecast"
    all_frames = []
    
    BATCH_SIZE = 20 
    total_locations = len(latitudes)
    print(f"🌍 Preparing to fetch {total_locations} locations in batches of {BATCH_SIZE}...")

    for i in range(0, total_locations, BATCH_SIZE):
        batch_lats = latitudes[i : i + BATCH_SIZE]
        batch_lons = longitudes[i : i + BATCH_SIZE]
        batch_num = i // BATCH_SIZE + 1
        
        print(f"   -> Processing Batch {batch_num}...")

        # EXACT hourly parameters requested by the client schema
        params = {
            "latitude": batch_lats,
            "longitude": batch_lons,
            "hourly": [
                "temperature_2m", "weather_code", "pressure_msl", "visibility", 
                "wind_speed_10m", "precipitation", "cloud_cover", "snow_depth", 
                "surface_pressure", "temperature_80m", "soil_temperature_0cm", 
                "soil_moisture_0_to_1cm"
            ],
            "timezone": "Europe/Berlin",
            "start_date": start_date,
            "end_date": end_date,
        }

        max_retries = 3
        for attempt in range(max_retries):
            try:
                responses = openmeteo.weather_api(url, params=params)
                break 
            except Exception as e:
                error_str = str(e).lower()
                if "limit exceeded" in error_str or "429" in error_str:
                    print(f"⚠️ Rate Limit Hit. Sleeping 65s...")
                    time.sleep(65)
                else:
                    print(f"❌ Error fetching batch: {e}")
                    responses = []
                    break

        if not responses:
            continue

        for response in responses:
            lat = response.Latitude()
            lon = response.Longitude()
            hourly = response.Hourly()
            
            # Create the DataFrame mapping
            hourly_data = {"date": pd.date_range(
                start = pd.to_datetime(hourly.Time(), unit = "s", utc = True),
                end =  pd.to_datetime(hourly.TimeEnd(), unit = "s", utc = True),
                freq = pd.Timedelta(seconds = hourly.Interval()),
                inclusive = "left"
            )}
            
            # Extract all 12 requested variables
            hourly_data["temperature_2m"] = hourly.Variables(0).ValuesAsNumpy()
            hourly_data["weather_code"] = hourly.Variables(1).ValuesAsNumpy()
            hourly_data["pressure_msl"] = hourly.Variables(2).ValuesAsNumpy()
            hourly_data["visibility"] = hourly.Variables(3).ValuesAsNumpy()
            hourly_data["wind_speed_10m"] = hourly.Variables(4).ValuesAsNumpy()
            hourly_data["precipitation"] = hourly.Variables(5).ValuesAsNumpy()
            hourly_data["cloud_cover"] = hourly.Variables(6).ValuesAsNumpy()
            hourly_data["snow_depth"] = hourly.Variables(7).ValuesAsNumpy()
            hourly_data["surface_pressure"] = hourly.Variables(8).ValuesAsNumpy()
            hourly_data["temperature_80m"] = hourly.Variables(9).ValuesAsNumpy()
            hourly_data["soil_temperature_0cm"] = hourly.Variables(10).ValuesAsNumpy()
            hourly_data["soil_moisture_0_to_1cm"] = hourly.Variables(11).ValuesAsNumpy()
            
            df = pd.DataFrame(data=hourly_data)
            df['latitude'] = lat
            df['longitude'] = lon
            all_frames.append(df)
        
        time.sleep(0.5) 

    if all_frames:
        master_df = pd.concat(all_frames, ignore_index=True)
        master_df.to_csv(master_csv, index=False)
        print(f"✅ SUCCESS: Weather saved to S3: {master_csv}")