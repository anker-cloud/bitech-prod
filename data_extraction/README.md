# BiTech Combined Data Pipeline

An automated, containerized **ETL (Extract, Transform, Load)** data pipeline that aggregates, processes, and correlates urban security, transit, and environmental datasets across Germany, with a primary focus on the Cologne region. 

The pipeline collects data across four specialized core vectors: **Crime Incidents**, **Traffic & Highway Conditions**, **Major Public Events**, and **Spatial Weather Data**. It operates under a production-ready serverless architecture orchestrated by AWS Step Functions and processed via containerized AWS Lambda functions, landing data into a schema-enforced S3 Data Lake for downstream analytics via AWS Glue.

---

## 🏗️ Architecture Overview

The pipeline implements a two-tier orchestration pattern to manage end-to-end data processing:

1. **Macro-Orchestration (AWS Step Functions):** Manages the broader cloud workflow lifecycle. It initiates the containerized AWS Lambda extraction job, monitors its lifecycle, checks execution status, and immediately triggers downstream **AWS Glue Crawlers and Jobs** upon successful ingestion to catalog and refresh database tables.
2. **Micro-Orchestration (`run_pipeline.py`):** Acts as the runtime internal manager inside the Docker container. It sequentially invokes the sub-modules using isolated Python subprocess contexts, ensures dynamic date partitioning across runs, manages shared environment variables, and organizes datasets before delivery.

```
AWS Step Functions (Macro-Orchestrator)
       │
       ▼
┌────────────────────────────────────────────────────────┐
│ AWS Lambda (Micro-Orchestrator: run_pipeline.py)       │
│                                                        │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────┐  │
│  │Traffic Module│ ──>│Events Module │ ──>│Crime Module│  │
│  └──────────────┘   └──────────────┘   └────────────┘  │
│                                               │        │
│                                               ▼        │
│                                        ┌────────────┐  │
│                                        │Weather Mod │  │
│                                        └────────────┘  │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ Amazon S3 Data Lake                                    │
│                                                        │
│  📂 bronze/             📂 helper-data/                 │
│  ├── traffic-data/      ├── crime-data/ (Raw Scrapes)  │
│  ├── event-data/        ├── cache/ (PLZ Coordinates)   │
│  └── crime-data/        └── weather/ (Staging files)   │
└───────────────────────────┬────────────────────────────┘
                            │ (Triggered on Success)
                            ▼
                    AWS Glue Crawler ──> Data Catalog / Athena
```

---

## 📁 Repository Structure

```text
BiTech_Combined/
├── run_pipeline.py            # Master micro-orchestration entrypoint
├── Dockerfile                 # Slim deployment configuration for AWS Lambda/ECR
├── partition_utils.py         # Shared utility for dynamic S3 path resolution
├── requirements.txt           # Pipeline package dependencies
│
├── Traffic_Module/
│   ├── main.py                # Traffic execution wrapper
│   ├── fetch_traffic_data.py  # Cologne local open-data path scraper
│   └── fetch_highway_data.py  # Autobahn API warning/roadwork extractor
│
├── Events_Module/
│   └── main.py                # Perplexity AI API event collector & geocoder
│
├── Crime_Module/
│   ├── main.py                # Crime & Incident orchestrator
│   ├── scraper.py             # Headless Selenium scraper for NRW Police Portal
│   ├── merge_data.py          # Spatial geocoder using Nominatim API
│   └── weather_wrapper.py     # Open-Meteo historical batch engine
│
└── Weather_Module/
    ├── main.py                # Standalone Weather orchestrator
    ├── plz_to_latlong.py      # Pre-processing coordinate fetcher
    ├── weather_forecast.py    # Open-Meteo 7-day predictive client
    ├── simple_merge.py        # cKDTree high-speed spatial matching engine
    └── get_array.py           # Data array transformation utility
```

---

## 🛠️ Module Breakdowns & Core Implementations

### 1. Traffic Module
Extracts real-time transit status from dual sources:
* **Local Logistics (Cologne Open Data):** Fetches active urban road segments via the Cologne Traffic API. It parses polyline coordinates, assigns spatial metrics, and applies an optimization technique that reverse-geocodes only the head of a path segment to capture postal codes without hitting API timeouts, then expands individual coordinate lines for granular mapping.
* **National Highways (Autobahn API):** Dynamically queries the Federal `verkehr.autobahn.de` API across over 100 valid German expressways (e.g., A1, A3). Pulls real-time roadworks, congestion zones, and traffic hazards. It applies regex tokenization to decompose messy `startTimestamp` tags cleanly into normalized `start_date` and `start_time` configurations.

### 2. Events Module
Discovers large-scale public occurrences (crowds > 500) within Germany spanning a floating 14-month window (e.g., Nov 2025 – Dec 2026).
* **AI Search Layer:** Interfaces with the **Perplexity AI API (`sonar-pro` model)** to execute live web searches, gathering non-trivial public events, festivals, concerts, and stadium metrics.
* **Geocoding & Deduplication:** Processes text-based venue descriptions through `geopy` (Nominatim) to pull lat/long pairs. It tags real-time event lifecycles (`upcoming`, `ongoing`, `finished`) based on current timestamp matrices and implements multi-key deduplication (Start Date + PLZ + City) to ensure clean datasets.

### 3. Crime Module
Uncovers security incidents reported across the state of North Rhine-Westphalia (NRW).
* **Browser Automation Scraper:** Runs an automated **Selenium WebDriver** in a custom headless environment optimized for serverless containers. It handles target police portals, bypasses cookie barriers, sets dynamic date filter thresholds, and triggers "Load More" pagination rules to pull raw reporting records.
* **Information Extraction:** Deploys Regular Expressions (Regex) to parse 5-digit German postal codes (PLZ) straight out of arbitrary, non-structured incident descriptions.

### 4. Weather Module
Operates as the primary environmental telemetry framework, serving both predictive analytics and spatial consolidation.
* **API Ingestion Engine:** Connects to the **Open-Meteo API** to batch locations in blocks of 20, maintaining strict compliance with public rate limits. It handles HTTP 429 errors using automated 65-second back-off sleep cycles.
* **Spatial Matching Engine:** Implements a **cKDTree (K-Dimensional Tree)** nearest-neighbor search from `scipy.spatial`. This performs immediate, high-performance geometric calculations to match incoming weather data frames to the closest recorded urban postal code coordinates in fractions of a second, completely bypassing slow execution loops.

---

## 🗄️ S3 Storage & Partitioning Protocol

To avoid **AWS Glue schema mismatches** during recursive data crawls, the repository enforces strict data isolation at the S3 level. Operational analytic tables are separated from raw scrapers and temporary caching files.

### 1. Analytical Layer (Bronze Production Buckets)
*Enforced schema conformity. Glue Crawlers are pointed only here.*
* **Traffic Data Partition:** `s3://bitech-pbac-data-prd/traffic-data/bronze/YYYY-MM-DD/`
  * Contains final clean files: `cologne_traffic_data_exploded.csv`, `A1_highway_data.csv`, etc.
* **Event Data Partition:** `s3://bitech-pbac-data-prd/event-data/bronze/YYYY-MM-DD/`
  * Contains final clean files: `germany_events_nationwide_strict.csv`, `koln_events_only.csv`.
* **Crime Data Partition:** `s3://bitech-pbac-data-prd/crime-data/bronze/YYYY-MM-DD/`
  * Contains final clean files: `crime_data_with_coords_and_city.csv`, `crime_weather_data_master.csv`.
* **Weather Data Partition:** `s3://bitech-pbac-data-prd/weather-data/bronze/YYYY-MM-DD/`
  * Contains final clean files: `crime_weather_data_forecast_7days.csv`.

### 2. Operational Layer (Helper & Staging Buckets)
*Isolates unstructured or intermediate data, preventing Glue from throwing layout errors.*
* **Staging Directory:** `s3://bitech-pbac-data-prd/helper-data/crime-data/YYYY-MM-DD/`
  * Houses raw un-geocoded scrapes: `crime_data_raw_with_plz.csv`.
  * Houses temporary coordinate split files: `weather_data/*.csv`.
* **Persisted Coordinate Caching:** `s3://bitech-pbac-data-prd/helper-data/crime-data/plz_coords_cache.csv`
  * Maintains a global repository memory map of previously geocoded locations to prevent duplicate API requests to Nominatim.

*Note: S3 path string configurations implement suffix handling via `partition_utils.py`. If a script is rerun on the same calendar day, it generates a sub-directory using sequential suffixes (e.g., `YYYY-MM-DD (1)`, `YYYY-MM-DD (2)`) rather than overwriting historical runs.*

---

## 🚀 Deployment & Containerization (AWS Lambda)

The system is compiled using a specialized configuration within a custom Docker image designed to satisfy severe cloud environment dependencies.

### 1. Docker Specifications (`Dockerfile`)
Built on `python:3.9-slim`, the image installs core OS-level system attachments and caches Python requirements. It explicitly sets environmental variables to manage browser dependencies:
```dockerfile
FROM python:3.9-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV DISPLAY=:99
CMD ["python", "run_pipeline.py"]
```

### 2. Lambda Execution Environment Settings
To support high-throughput data extraction and stable web rendering via Selenium, ensure your target AWS Lambda function complies with these baseline specifications:
* **Memory Allocation:** Minimum **4096 MB** (safeguards Chromium memory footprint from crashing during DOM loops).
* **Timeout Threshold:** **15 Minutes** (accommodates API rate limit delays and Nominatim sleep requirements).
* **WebDriver Flags:** The underlying scraper layer explicitly passes strict headless parameters to run inside Lambda's secure execution context:
  ```python
  chrome_options.add_argument("--headless=new")
  chrome_options.add_argument("--no-sandbox")
  chrome_options.add_argument("--disable-dev-shm-usage")
  chrome_options.add_argument("--disable-gpu")
  chrome_options.add_argument("--single-process")
  ```

---

## 💻 Local Testing & Manual Runs

To evaluate the pipeline sequence on a local machine before deployment to AWS ECR, execute the micro-orchestration suite directly from the repository root:

```bash
# Create and source a clean python virtual environment
python -m venv venv
source venv/bin/activate  # On Windows use: venv\\Scripts\\activate

# Install essential dependencies
pip install -r requirements.txt

# Run the full automated pipeline locally
python run_pipeline.py
```

The master script will trigger all four architectural domains sequentially, output clean performance summaries to your stdout terminal, and generate immediate files locally before sync logic takes over.