import pandas as pd
import os

# Grab exact paths from main.py's environment variables
CRIME_DATA_S3 = os.environ.get('CRIME_DATA_S3')
POSTAL_OUTPUT = os.environ.get('POSTAL_FILE_S3')

def extract_postal_coordinates():
    print(f"📍 Reading crime coords from: {CRIME_DATA_S3}")
    try:
        df = pd.read_csv(CRIME_DATA_S3, dtype={'PLZ': str})
    except Exception as e:
        print(f"❌ Could not read crime data from S3: {e}")
        raise

    df = df.dropna(subset=['latitude', 'longitude'])

    if df.empty:
        print("❌ No valid coordinates found in crime data.")
        raise ValueError("Empty coordinate set — cannot proceed.")

    postal_df = (
        df[['PLZ', 'latitude', 'longitude']]
        .rename(columns={'PLZ': 'postal_code'})
        .drop_duplicates(subset=['postal_code'])
        .reset_index(drop=True)
    )

    print(f"   -> {len(postal_df)} unique postal codes extracted.")

    try:
        postal_df.to_csv(POSTAL_OUTPUT, index=False, encoding='utf-8-sig')
        print(f"✅ Postal coordinates saved to Helper S3: {POSTAL_OUTPUT}")
    except Exception as e:
        print(f"❌ Failed to save postal coordinates to S3: {e}")
        raise

if __name__ == "__main__":
    extract_postal_coordinates()
# import pandas as pd