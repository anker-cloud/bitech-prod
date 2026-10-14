# AWS Glue ETL Jobs – BiTech Data Pipeline

This document describes the AWS Glue jobs that transform raw source data (**Bronze** layer) into cleaned, standardized, query-ready data (**Silver** layer) for the BiTech platform.
---

## What These Jobs Do (In General)

Every Glue job follows the same **Bronze → Silver** pattern:

1. **Read** raw CSV files from the Bronze S3 layer (recursively, including all sub-folders).
2. **Clean** the data — normalize column names, convert empty strings to `NULL`, fix data types.
3. **Parse timestamps** and derive `year` / `month` / `day` partition columns.
4. **Deduplicate** records so each row is unique.
5. **Write** the result to the Silver S3 layer as **Parquet** (compressed, partitioned by date).

All jobs use **dynamic partition overwrite**, meaning only the affected date partitions are rewritten on each run — existing historical data is preserved.

- **Storage bucket:** `s3://bitech-pbac-data-prd/`
- **Output format:** Parquet (Snappy compression where configured)
- **Partitioning:** `year / month / day`
- **Region:** `eu-central-1`

---

## Job-by-Job Summary

| Script | Data Domain | Bronze → Silver Path |
|--------|-------------|----------------------|
| `glue-etl-prd-traffic-data-glue-bronze_to_silver.py` | Traffic | `traffic-data/bronze/` → `traffic-data/silver/` |
| `glue-etl-prd-event-data-glue-bronze_to_silver.py` | Events | `event-data/bronze/` → `event-data/silver/` |
| `glue-etl-prd-crime-data-glue-bronze_to_silver.py` | Crime | `crime-data/bronze/` → `crime-data/silver/` |
| `glue-prd-weather-data-bronze_silver_v2.py` | Weather | `weather-data/bronze/` → `weather-data/silver/` |
| `etl-job-policy-table.py` | Insurance / Policy | `insurance_data/bronze/` → `insurance_data/silver/` |

---

### 1. Traffic Data — `glue-etl-prd-traffic-data-glue-bronze_to_silver.py`

Processes traffic records.

- Cleans column names and converts empty strings to `NULL`.
- Standardizes field names (`isblocked` → `is_blocked`, `lat` → `latitude`, `lon` → `longitude`).
- Builds a precise `event_timestamp` by combining `start_date` with `start_time` (parsed into hours/minutes/seconds).
- Validates that timestamps and partition values are present — the job **aborts** if parsing fails for all records.
- Deduplicates on `event_timestamp`, `latitude`, `longitude`, `highway`, and `identifier`.
- Writes Snappy-compressed Parquet partitioned by date.

---

### 2. Event Data — `glue-etl-prd-event-data-glue-bronze_to_silver.py`

Processes public event data (used for insurance and conflict/riot matching).

- Normalizes column names and empty strings.
- Safely converts `postal_code` to an integer (invalid values become `NULL`).
- Parses `start_date` / `end_date` into timestamps and derives partitions.
- Fills missing `latitude` / `longitude` with `0.0`.
- **Normalizes the messy `expected_crowd` field** into a clean number — e.g. `"1,200"` → `1200`, `">500"` / `"500+"` → `500`, `"Over 500,000"` → `500000`; vague values like `"Unknown"`, `"Thousands"` become `NULL`.
- Trims all text columns before deduplication (to catch byte-level duplicates).
- Removes only exact duplicates — **all occurrence statuses (upcoming / ongoing / finished) are intentionally preserved** because they matter for insurance analysis.
- Generates a deterministic `event_id` using a **SHA-256 hash** of six key fields to guarantee a unique ID per row.

---

### 3. Crime Data — `glue-etl-prd-crime-data-glue-bronze_to_silver.py`

Processes German crime report data.

- Renames source columns to clean names (`PLZ` → `postal_code`, `Date` → `date_time`, etc.).
- **Parses German-language datetimes** — understands German month names (`Januar`, `März`, `Dezember`, …) and the `date | time` format via a custom function.
- Converts empty strings to `NULL` and `postal_code` to an integer.
- Derives `year` / `month` / `day` partitions from the parsed datetime.
- Removes exact duplicate rows.
- Writes Parquet with dynamic partition overwrite.

---

### 4. Weather Data — `glue-prd-weather-data-bronze_silver_v2.py`

Processes weather observations.

- Converts empty strings to `NULL` and `postal_code` to an integer.
- Parses the `date` field (format `yyyy-MM-dd HH:mm:ssXXX`) into an `event_timestamp` and derives partitions.
- **Drops records with invalid/NULL timestamps before deduplication** to keep the Silver layer clean.
- Deduplicates on `city_name`, `latitude`, `longitude`, and `event_timestamp`.
- Exits gracefully if the Bronze layer is empty.
- Writes Parquet partitioned by date.

---

### 5. Policy / Insurance Data — `etl-job-policy-table.py`

Processes insurance policy records.

- Renames columns (`firstname` → `first_name`, `lastname` → `last_name`, `city` → `city_name`).
- **Normalizes German text** in `city_name` — converts umlauts and special characters (`ä`→`a`, `ö`→`o`, `ü`→`u`, `ß`→`ss`) and lowercases, so city names match consistently across datasets.
- Converts empty strings to `NULL`.
- Derives `year` / `month` / `day` partitions from `inception_date`.
- Filters out rows with invalid/missing dates.
- Writes Parquet partitioned by date.

---

## Reliability & Logging

- Every job wraps its logic in **try / except / finally** blocks with detailed logging (record counts, duplicates removed, validation results).
- Jobs **fail fast** and raise an error if the Bronze layer is empty or timestamp parsing fails, so problems surface immediately rather than silently producing bad data.
- `job.commit()` is called to properly finalize each Glue job run.

---

## Where These Jobs Fit in the Pipeline

These five Glue jobs are triggered in **parallel** by the Step Functions orchestrator (`bitech-glue-etl-orchestrator.json`), after which Glue crawlers catalog the Silver data for querying in Athena. See [`../step_functions/ORCHESTRATION.md`](../step_functions/ORCHESTRATION.md) for the full end-to-end flow.
