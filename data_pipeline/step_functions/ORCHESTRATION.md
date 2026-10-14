# BiTech Data Pipeline – Orchestration Guide

This document explains how the BiTech data pipeline is orchestrated end-to-end using **Amazon EventBridge** and **AWS Step Functions**, and how the two services work together. It is intended to give a clear, non-technical-to-technical overview of the automated flow.

---

## 1. High-Level Overview

The pipeline runs **automatically every day** with no manual effort. The flow is:

```
EventBridge (daily schedule)
        │
        ▼
Step Functions: Data Extraction Pipeline   → pulls raw source data (Bronze)
        │
        ▼
Step Functions: Glue ETL Orchestrator      → transforms Bronze → Silver + catalogs data
        │
        ▼
        Data ready for querying (Athena / BI tools)
```

Two AWS services drive this automation:

| Service          | Role in the Pipeline                                                    |
|------------------|-------------------------------------------------------------------------|
| **EventBridge**  | The *scheduler* – decides **when** the pipeline runs.                   |
| **Step Functions** | The *orchestrator* – decides **what** runs, in **what order**, and handles retries and error handling. |

---

## 2. EventBridge – The Trigger (When)

EventBridge is a scheduling and event-routing service. In this pipeline it acts as a **daily alarm clock**.

- **Rule name:** `bitech-daily-etl-trigger`
- **Schedule (cron):** `30 7 * * ? *` → runs **every day at 07:30 UTC**
- **Region:** `eu-central-1`
- **Target:** Starts the Step Functions execution.

See [`../aws_eventbridge/bitech-daily-etl-trigger.md`](../aws_eventbridge/bitech-daily-etl-trigger.md) for full rule details.

Because EventBridge runs on a fixed schedule, the pipeline is fully hands-off — no one needs to log in and start the jobs manually.

---

## 3. Step Functions – The Orchestrator (What & In What Order)

Step Functions is a workflow engine. It coordinates multiple AWS services (Lambda, Glue, crawlers) as a series of **states**, managing the sequence, retries, waiting, and success/failure decisions automatically.

The pipeline is split into **two state machines**:

### 3.1 Data Extraction Pipeline — `bitech_data_extraction_pipeline.json`

**Purpose:** Extract raw data from source systems into the **Bronze** layer.

**Pattern:** Sequential (one module after another). This avoids overloading source APIs and keeps extraction predictable.

```
TrafficModule → EventsModule → CrimeModule → WeatherModule → Done
```

- Each state invokes the same Lambda function (`BiTech-Data-extractor`) with a different `step` payload (`traffic`, `events`, `crime`, `weather`).
- The first module (`TrafficModule`) has a **retry policy**: up to 2 retries with a 30-second interval and exponential backoff, so transient failures don't break the run.

### 3.2 Glue ETL Orchestrator — `bitech-glue-etl-orchestrator.json`

**Purpose:** Transform the Bronze data into the cleaned, standardized **Silver** layer and update the data catalog.

**Pattern:** Parallel transformation, then catalog crawling.

```
RunGlueJobs (Parallel)
    ├── CrimeJob      (glue-etl-prd-crime-data-glue-bronze_to_silver)
    ├── EventJob      (glue-etl-prd-event-data-glue-bronze_to_silver)
    ├── WeatherJob    (glue-prd-weather-data-bronze_silver_v2)
    ├── PolicyJob     (etl-job-policy-table)
    └── TrafficJob    (glue-etl-prd-traffic-data-glue-bronze_to_silver)
            │
            ▼
StartCrawlers        → Lambda: start-glue-crawlers
            │
            ▼
WaitForCrawlers      → wait 60 seconds
            │
            ▼
CheckCrawlerStatus   → Lambda: check-glue-crawlers-status
            │
            ▼
CrawlerDecision (Choice)
    ├── all crawlers done?  → yes → SuccessState ✅
    └── no → loop back to WaitForCrawlers
```

**Why this design:**

- **Parallel Glue jobs** — the five ETL jobs are independent, so running them at the same time shortens total runtime. Each job has its own retry policy (3 attempts, 30s interval, backoff).
- **Crawlers after ETL** — once Silver data is written, Glue crawlers scan it and update the Data Catalog so the data is queryable in Athena.
- **Wait + Check loop** — crawlers take time to finish. The workflow waits 60 seconds, checks status, and keeps looping until **all crawlers report done** before declaring success. This guarantees the pipeline only finishes when the catalog is fully up to date.

---

## 4. Supporting Lambda Functions

The crawler coordination is handled by two small Lambda functions (in [`./lambda/`](./lambda/)):

| Lambda                        | Responsibility                                                                 |
|-------------------------------|--------------------------------------------------------------------------------|
| `start-glue-crawlers.py`      | Starts all 10 Glue crawlers (staging + prod for crime, event, insurance, traffic, weather). |
| `check-glue-crawlers-status.py` | Polls every crawler's state and returns `all_done = true` only when none are still `RUNNING` or `STOPPING`. |

Step Functions uses the `all_done` flag from the status Lambda to decide whether to finish or keep waiting.

---

## 5. How EventBridge and Step Functions Work Together

1. **EventBridge** fires on schedule (daily at 07:30 UTC).
2. It **triggers Step Functions**, which begins the orchestration.
3. **Step Functions** then takes over completely — invoking Lambdas, running Glue jobs in parallel, starting crawlers, waiting, checking status, and retrying on failure.
4. The workflow ends in a **Success** state only when all data is transformed and catalogued.

In short: **EventBridge decides *when* the pipeline runs; Step Functions decides *how* it runs and makes sure every step completes correctly.**

---

## 6. Benefits

- **Fully automated** — runs daily with zero manual intervention.
- **Reliable** — built-in retries and status checks handle transient failures.
- **Efficient** — independent ETL jobs run in parallel to reduce runtime.
- **Observable** — each state and execution is visible in the AWS Step Functions console for easy monitoring and troubleshooting.
- **Consistent** — data is only marked ready once the catalog is fully updated, so downstream BI/Athena queries always see complete data.
