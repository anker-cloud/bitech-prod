import requests
import pandas as pd

def extract_traffic_data():
    """Fetches and processes Cologne-specific traffic data."""
    url = "https://geoportal.stadt-koeln.de/arcgis/rest/services/verkehr/verkehrskalender/MapServer/0/query?where=1%3D1&outFields=*&f=json"
    
    try:
        response = requests.get(url)
        if response.status_code == 200:
            data = response.json()
            features = data.get('features', [])
            
            # Flatten the attributes
            rows = [f.get('attributes', {}) for f in features]
            df = pd.DataFrame(rows)
            return df
        else:
            print(f"⚠️ Error fetching Cologne data: {response.status_code}")
            return pd.DataFrame()
    except Exception as e:
        print(f"❌ Error: {e}")
        return pd.DataFrame()