# BiTech Data Extraction — Simple Guide

This document explains, how the BiTech platform **collects (extracts)** its raw data. This is the very first stage of the data pipeline — it gathers data from external sources and lands it in the **Bronze** layer in S3, ready for cleaning and cataloging later.

---

## 1. The Big Picture

Every day, an automated job reaches out to four different kinds of public data sources, collects fresh data, tidies it into a consistent format, and saves it to cloud storage (Amazon S3).

```
            ┌─────────────────────────────────────────────┐
            │   Daily automated extraction job            │
            │   (runs in AWS, no manual effort)           │
            └───────────────────┬─────────────────────────┘
                                │
        ┌───────────────┬───────┴───────┬────────────────┐
        ▼               ▼               ▼                ▼
   ┌─────────┐     ┌─────────┐     ┌─────────┐      ┌─────────┐
   │ Traffic │     │ Events  │     │  Crime  │      │ Weather │
   └────┬────┘     └────┬────┘     └────┬────┘      └────┬────┘
        └───────────────┴───────┬───────┴────────────────┘
                                ▼
                 ┌──────────────────────────────┐
                 │  Amazon S3 — "Bronze" layer   │
                 │  (raw collected data, as CSV) │
                 └──────────────────────────────┘
```

The four sources are collected **one after another**: **Traffic → Events → Crime → Weather**. Weather runs last on purpose, because it uses locations from the crime data to decide where to pull weather for.

**Coverage today:** primarily the **Cologne (Köln) region** within **North Rhine-Westphalia (NRW)**, with some data gathered Germany-wide.

---

## 2. How It Runs (Automation)

- The whole extraction is packaged as a single cloud job (a containerized **AWS Lambda** function) and triggered by **AWS Step Functions**.
- A small internal controller script (`run_pipeline.py`) runs each of the four modules in turn. If any module fails, the job reports the failure so it can be retried or flagged — nothing fails silently.
- Each source can also be run on its own (the Step Function sends a simple instruction like `{"step": "traffic"}` to run just the traffic part).

---

## 3. The Four Data Sources

### Traffic
**What it collects:** current road conditions, roadworks, congestion, and hazards.

- **Cologne city roads** — pulls active road segments from Cologne's public traffic data, works out their location, and looks up the postal code for each.
- **German highways (Autobahn)** — queries the official national Autobahn service for highways such as **A1** and **A3**, collecting live roadworks and traffic warnings. Messy timestamps are tidied into clean separate **date** and **time** columns.

**Where it's saved:** `traffic-data/bronze/` (highway files like `A1_highway_data.csv`).

### Events
**What it collects:** major public events (festivals, concerts, stadium events) expected to draw **large crowds (500+ people)**, across a rolling multi-month window (roughly 5 months back to 8 months ahead).

- Uses an **AI-powered web search** (Perplexity AI) to find events, prioritizing **Cologne first**, then filling in with other German cities.
- Each event is **geocoded** (its address turned into map coordinates) and tagged as **upcoming**, **ongoing**, or **finished** based on today's date.
- Duplicate events are removed (matched on date + postal code + city).

**Where it's saved:** `event-data/bronze/` — a nationwide file and a Cologne-only file.

### Crime
**What it collects:** publicly reported security incidents across **North Rhine-Westphalia (NRW)**.

- An automated browser (**Selenium**) visits the regional police information portal, handles cookie banners, sets the date range, and clicks through "load more" to gather the reports.
- German **postal codes** are pulled out of the free-text incident descriptions.
- Each incident is then **geocoded** to map coordinates so it can be placed on a map and linked to weather.

**Where it's saved:** `crime-data/bronze/` (e.g. `crime_data_with_coords_and_city.csv`), with raw intermediate scrapes kept separately in a helper area.

### Weather
**What it collects:** weather data matched to the locations found in the crime data.

- Takes the locations (postal codes/coordinates) from the latest crime extract.
- Calls the **Open-Meteo** weather service in batches, respecting the service's rate limits (it automatically waits and retries if asked to slow down).
- Uses a fast "nearest-location" matching technique to attach the right weather reading to each location, then merges crime + weather into one dataset.

**Where it's saved:** `weather-data/bronze/` (the merged crime-and-weather dataset).

---

## 4. Where the Data Lands in S3

All collected data goes into one storage bucket, organized by source and dated:

```
s3://bitech-pbac-data-prd/
├── traffic-data/bronze/YYYY-MM-DD/     ← Traffic files
├── event-data/bronze/YYYY-MM-DD/       ← Events files
├── crime-data/bronze/YYYY-MM-DD/       ← Crime files
├── weather-data/bronze/YYYY-MM-DD/     ← Weather files
└── helper-data/                        ← temporary / working files (not cataloged)
```

Two important points:

1. **Dated folders.** Each run saves into a folder named by date (e.g. `2026-10-14/`). If the job runs more than once on the same day, it creates `2026-10-14 (1)`, `2026-10-14 (2)`, and so on — so **previous runs are never overwritten**.

2. **Clean vs. working data are kept apart.** The final, well-structured files go into the `bronze/` folders (these are the ones later cataloged by AWS Glue). Raw scrapes and temporary files are kept in a separate `helper-data/` area so they don't interfere with the cataloging step.

---

## 5. What Happens Next

Extraction only *collects* the raw data. After this stage:

1. **Glue ETL jobs** clean and standardize the Bronze data into the **Silver** layer.
2. **Glue Crawlers** catalog the Silver data so it becomes queryable.
3. The data is then available through **Athena** and the application for analysis.

For that downstream flow, see the pipeline walkthrough in
[`../data_pipeline/docs/pipeline_walkthrough.md`](../data_pipeline/docs/pipeline_walkthrough.md).

---

## 6. Quick Summary

| Source | What it gathers | Main technique | Saved to |
|--------|-----------------|----------------|----------|
| **Traffic** | Road conditions, roadworks, highway warnings | Cologne open data + national Autobahn service | `traffic-data/bronze/` |
| **Events** | Large public events (500+ crowd) | AI web search + geocoding | `event-data/bronze/` |
| **Crime** | Reported incidents in NRW | Automated browser scraping + geocoding | `crime-data/bronze/` |
| **Weather** | Weather matched to crime locations | Open-Meteo API + nearest-location matching | `weather-data/bronze/` |

In short: four independent collectors, running daily and automatically, each landing clean dated files into cloud storage — forming the foundation for everything the platform does downstream.
