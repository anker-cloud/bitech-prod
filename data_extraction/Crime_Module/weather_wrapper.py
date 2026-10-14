import openmeteo_requests
import pandas as pd
import requests_cache
from retry_requests import retry
import time

def fetch_weather_batch(latitudes, longitudes, start_date, end_date, output_folder, master_csv):
    """
    Fetches historical weather data and saves directly to S3.
    """
    cache_session = requests_cache.CachedSession('Crime_Module/.cache', expire_after=3600)
    retry_session = retry(cache_session, retries=5, backoff_factor=0.2)
    openmeteo = openmeteo_requests.Client(session=retry_session)
    
    url = "https://api.open-meteo.com/v1/forecast"
    all_frames = []
    BATCH_SIZE = 20 
    total_locations = len(latitudes)

    for i in range(0, total_locations, BATCH_SIZE):
        batch_lats = latitudes[i : i + BATCH_SIZE]
        batch_lons = longitudes[i : i + BATCH_SIZE]
        
        params = {
            "latitude": batch_lats, "longitude": batch_lons,
            "daily": ["precipitation_probability_max", "apparent_temperature_max", "apparent_temperature_min"],
            "hourly": ["temperature_2m", "weather_code", "precipitation", "cloud_cover"],
            "timezone": "Europe/Berlin", "start_date": start_date, "end_date": end_date,
        }

        try:
            responses = openmeteo.weather_api(url, params=params)
        except Exception as e:
            print(f"❌ Error fetching batch: {e}")
            continue

        for response in responses:
            hourly = response.Hourly()
            hourly_data = {
                "date": pd.date_range(
                    start=pd.to_datetime(hourly.Time(), unit="s", utc=True),
                    end=pd.to_datetime(hourly.TimeEnd(), unit="s", utc=True),
                    freq=pd.Timedelta(seconds=hourly.Interval()), inclusive="left"
                ),
                "temperature_2m": hourly.Variables(0).ValuesAsNumpy(),
                "latitude": response.Latitude(),
                "longitude": response.Longitude()
            }
            
            df = pd.DataFrame(data=hourly_data)
            
            # Save Backup to S3
            fname = f"{output_folder}/{response.Latitude():.4f}_{response.Longitude():.4f}_{start_date}.csv"
            df.to_csv(fname, index=False)
            all_frames.append(df)
        
        time.sleep(0.25) 

    if all_frames:
        master_df = pd.concat(all_frames, ignore_index=True)
        master_df.to_csv(master_csv, index=False)
        print(f"✅ Master Weather File saved to S3: {master_csv}")