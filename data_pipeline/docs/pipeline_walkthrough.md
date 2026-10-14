# BiTech Data Pipeline – Final Walkthrough

A complete, end-to-end walkthrough of the BiTech data pipeline as it is deployed in AWS. This document is intended for the client and ties together every component — EventBridge, Step Functions, Glue jobs, crawlers, and Lambda functions — into one clear picture.

> All details below were verified against the live AWS environment.
> **Region:** `eu-central-1` · **Data bucket:** `s3://bitech-pbac-data-prd/`

---

## 1. The Big Picture

The pipeline is a fully automated, daily data workflow. It extracts raw data from source systems, transforms it into clean analytics-ready tables, catalogs it, and makes it queryable — with no manual effort.

```
┌──────────────────────────────────────────────────────────────────┐
│  EventBridge Schedule  (daily @ 07:30 UTC)                       │
│  rule: bitech-daily-etl-trigger                                  │
└───────────────────────────────┬──────────────────────────────────┘
                                 │ triggers
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│  Step Functions: bitech-glue-etl-orchestrator                    │
│                                                                  │
│   1. Run 5 Glue ETL jobs in PARALLEL  (Bronze → Silver)          │
│   2. Start all Glue crawlers          (Lambda)                   │
│   3. Wait + poll until crawlers finish (Lambda loop)             │
│   4. Succeed                                                     │
└───────────────────────────────┬──────────────────────────────────┘
                                 │ catalogs data into
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│  Glue Data Catalog  (database: bitech_prod_db)                   │
│  → queryable via Amazon Athena / BI tools                        │
└──────────────────────────────────────────────────────────────────┘

Separately:
┌──────────────────────────────────────────────────────────────────┐
│  Step Functions: BiTech-Data-Extraction-Pipeline                 │
│  Sequentially pulls raw source data into the Bronze layer        │
│  (Traffic → Events → Crime → Weather) via BiTech-Data-extractor  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. The Data Processing Flow (Start Here)

The core of the platform is the **data processing flow**, which moves data through S3 layers:

```
Source systems
     │  (extraction)
     ▼
BRONZE (raw CSV in S3)
     │  Glue ETL jobs: clean, standardize, dedupe
     ▼
SILVER (clean Parquet in S3, partitioned by year/month/day)
     │  Glue Crawler: infer schema, create/refresh tables
     ▼
GLUE DATA CATALOG / LAKE FORMATION (queryable tables)
     │
     ▼
GOLD (business/aggregated) + Athena / BI consumption
```

Read in order: **Bronze → Silver (Section 2–5)**, then the **Glue jobs that transform the data (Section 5)**, then the **Glue Crawler step (Section 6)**, then **Lake Formation tables & permissions (Section 6.4–6.5)**.

All data lives in `s3://bitech-pbac-data-prd/`, organized by domain, each with a Bronze / Silver / Gold layer:

```
bitech-pbac-data-prd/
├── traffic-data/      → bronze/  silver/  gold/
├── event-data/        → bronze/  silver/  gold/
├── crime-data/        → bronze/  silver/  gold/
├── weather-data/      → bronze/  silver/  gold/
├── insurance_data/    → bronze/  silver/  gold/
├── athena-post-op/
├── helper-data/
└── mapping_file/
```

| Layer | Meaning |
|-------|---------|
| **Bronze** | Raw ingested data (CSV), exactly as pulled from sources. |
| **Silver** | Cleaned, standardized, deduplicated data (Parquet, partitioned by `year/month/day`). Produced by the Glue ETL jobs. |
| **Gold** | Business/aggregated layer for downstream consumption. |

---

## 3. Component 1 — EventBridge (The Scheduler)

| Field | Value |
|-------|-------|
| Rule name | `bitech-daily-etl-trigger` |
| Schedule | `cron(30 7 * * ? *)` → **daily at 07:30 UTC** |
| Status | ENABLED |
| Target | Step Functions state machine `bitech-glue-etl-orchestrator` |
| Invoke role | Dedicated EventBridge → Step Functions service role |

EventBridge is the alarm clock. Each morning at 07:30 UTC it starts the Glue ETL orchestrator. No one has to trigger anything manually.

---

## 4. Component 2 — Step Functions (The Orchestrators)

Two state machines run the show.

### 4.1 `bitech-glue-etl-orchestrator`  *(triggered daily by EventBridge)*

- **Role:** Dedicated Step Functions execution role
- **Status:** ACTIVE
- **Flow:**
  1. **RunGlueJobs (Parallel)** — launches all 5 Glue ETL jobs at once (each with retry: 3 attempts, 30s, backoff).
  2. **StartCrawlers** — invokes the `start-glue-crawlers` Lambda.
  3. **WaitForCrawlers** — waits 60 seconds.
  4. **CheckCrawlerStatus** — invokes `check-glue-crawlers-status` Lambda.
  5. **CrawlerDecision (Choice)** — if all crawlers are done → **Success**; otherwise loop back to step 3.

This guarantees the run only finishes once the Silver data is fully written *and* the catalog is refreshed.

### 4.2 `BiTech-Data-Extraction-Pipeline`

- **Role:** Dedicated Step Functions execution role
- **Status:** ACTIVE
- **Flow (sequential):** `TrafficModule → EventsModule → CrimeModule → WeatherModule`
- Each state invokes the `BiTech-Data-extractor` Lambda with a different `step` payload. The first module has a retry policy (2 attempts). This fills the **Bronze** layer with raw source data.

---

## 5. Component 3 — Glue ETL Jobs (Bronze → Silver)

Five jobs, run in parallel by the orchestrator. Each reads a domain's Bronze CSVs, cleans and standardizes them, deduplicates, and writes partitioned Parquet to Silver.

| Glue Job | Domain |
|----------|--------|
| `glue-etl-prd-traffic-data-glue-bronze_to_silver` | Traffic |
| `glue-etl-prd-event-data-glue-bronze_to_silver` | Events |
| `glue-etl-prd-crime-data-glue-bronze_to_silver` | Crime |
| `glue-prd-weather-data-bronze_silver_v2` | Weather |
| `etl-job-policy-table` | Insurance / Policy |

**Runtime configuration (verified on the traffic job, representative):**
- Glue version **5.0**, worker type **G.1X**, **10 workers**, timeout **480 min**
- Runs under a dedicated Glue execution role

For a detailed, per-job explanation of the transformations, see
[`../aws_glue/GLUE_JOBS.md`](../aws_glue/GLUE_JOBS.md).

---

## 6. Component 4 — Glue Crawlers (Cataloging) — Detailed Flow

The Glue Crawler is one of the most important parts of the pipeline. The Glue ETL jobs produce clean Silver data as Parquet files in S3, but those files are just objects in a bucket — they are **not yet queryable**. The crawler is what turns those files into **catalogued tables** with a defined schema, which Athena, Lake Formation, and BI tools can then read.

This section explains the full crawler lifecycle: how crawlers are created, how they run after processing, how the resulting tables surface in Lake Formation, and how access is managed there.

### 6.1 What a Crawler Does

A Glue Crawler points at an S3 location, scans the files it finds there, **infers the schema** (column names, data types, partition structure), and creates or updates a corresponding table in the Glue Data Catalog. On every run it also picks up new `year/month/day` partitions so newly written data becomes immediately queryable.

### 6.2 How the Crawlers Are Created

Each crawler is defined once (via console / IaC) with the following configuration — verified from the live `bitech-prod-traffic-data` crawler as the representative example:

| Setting | Value |
|---------|-------|
| **Target database** | `bitech_prod_db` |
| **S3 target path** | `s3://bitech-pbac-data-prd/traffic-data/silver/` |
| **IAM role** | Dedicated Glue crawler role |
| **Table prefix** | `traffic_data_` (so the table is e.g. `traffic_data_silver`) |
| **Schema change policy** | Update: `UPDATE_IN_DATABASE`, Delete: `DEPRECATE_IN_DATABASE` |
| **Recrawl policy** | `CRAWL_EVERYTHING` |
| **Schedule** | `null` (not self-scheduled — the pipeline runs them on demand) |

Key points:
- Each crawler **points at the `silver/` prefix** of its domain, so it catalogs the cleaned output of the Glue job — not the raw Bronze data.
- The **schema change policy** means: if the ETL output adds or changes a column, the crawler updates the table definition in place (`UPDATE_IN_DATABASE`); if a column disappears, the old definition is marked deprecated rather than hard-deleted (`DEPRECATE_IN_DATABASE`). This keeps the catalog stable and auditable.
- Crawlers are **deliberately not self-scheduled** (`Schedule: null`). They are started by the orchestrator *after* the ETL jobs finish, which guarantees they only run against fully-written Silver data.

Crawlers exist for every domain across three environments:

| Environment | Crawlers | Catalogs into |
|-------------|----------|---------------|
| **prod** | `bitech-prod-{crime,event,insurance,traffic,weather}-data` | `bitech_prod_db` |
| **prd** | `bitech-prd-{crime,event,insurance,traffic,weather}-data` | (domain / prod DBs) |
| **staging** | `bitech-staging-{crime,event,insurance,traffic,weather}-data` | `bitech_staging_db` |

### 6.3 How the Crawlers Are Run (After Data Processing)

The crawlers are **not** run manually and **not** run on their own schedule. They are orchestrated by Step Functions immediately after the Glue ETL jobs complete:

```
Glue ETL jobs finish (Bronze → Silver written)
        │
        ▼
start-glue-crawlers  (Lambda)   → calls glue.start_crawler() for every crawler
        │
        ▼
WaitForCrawlers      (wait 60s)
        │
        ▼
check-glue-crawlers-status (Lambda) → glue.get_crawler() for each; all_done?
        │
        ├── not done → loop back to wait
        └── all done → catalog is refreshed ✅
```

Because the orchestrator loops on `check-glue-crawlers-status` until `all_done = true`, the pipeline only reports success once **every table in the catalog reflects the latest Silver data**.

### 6.4 How Crawled Tables Appear in Lake Formation

The Glue Crawler creates or updates the table metadata in the Glue Data Catalog. These cataloged databases and tables are then available in Lake Formation, where access permissions and governance are managed. In other words, **Glue Catalog handles metadata and schema discovery, while Lake Formation controls who can access the cataloged data.**

**Databases present (verified):**
`bitech_prod_db`, `bitech_staging_db`, `crime-data-db`, `events-data-db`, `insurance-data-db`, `traffic-data-db`, `weather-data-db`.

**Where to view the tables in Lake Formation:**
1. Open the **AWS Lake Formation** console (region `eu-central-1`).
2. In the left menu, go to **Data catalog → Databases** and select e.g. `bitech_prod_db`.
3. Click **View tables** to see all crawler-created tables (e.g. `traffic_data_silver`).
4. Open a table to inspect its **schema** (columns + types), **partitions** (`year/month/day`), and its underlying **S3 location**.

An **S3 location is registered with Lake Formation** so it can govern access to the data. Registration is done through the Lake Formation-managed data-access service role, which lets Lake Formation broker access to the underlying S3 data on behalf of permitted principals.

### 6.5 Permissions — How Access Is Assigned and Managed

Lake Formation controls **who can see and query which databases and tables**, on top of IAM. The permission model for `bitech_prod_db` is structured as follows:

**Data lake administrators** — a small set of named administrator identities have full control over Lake Formation settings and grants.

**Permissions on `bitech_prod_db`:**

| Principal | Permissions |
|-----------|-------------|
| Glue crawler role | `CREATE_TABLE`, `DESCRIBE`, `DROP` |
| Administrator users | `ALL`, `ALTER`, `CREATE_TABLE`, `DESCRIBE`, `DROP` |
| `IAM_ALLOWED_PRINCIPALS` | `ALL` |

What this means in practice:
- The **crawler role** has exactly the permissions it needs to create, describe, and drop tables in the database — nothing more.
- **Administrator users** have full control for managing tables and grants.
- `IAM_ALLOWED_PRINCIPALS` with `ALL` means the database currently also falls back to **IAM-based access** (the default "backwards-compatible" Lake Formation mode). To enforce fine-grained Lake Formation permissions strictly, this fallback grant would be removed so that only explicitly-granted principals have access.

**How to view and manage permissions in Lake Formation:**
1. Lake Formation console → **Permissions → Data lake permissions**.
2. You will see each grant as a row: *principal → resource (database/table) → permissions*.
3. Click **Grant** to add access: choose the IAM user/role, pick the database or specific table (and optionally column-level access), and select permissions (`SELECT`, `DESCRIBE`, `ALTER`, etc.).
4. Click **Revoke** on any existing row to remove access.
5. To manage who can administer governance itself: **Administration → Data lake settings → Data lake administrators**.

This gives a central, auditable place to answer "who can query the crime data table?" and to grant or revoke that access without touching S3 bucket policies directly.

---

## 6A. Data Coverage & Required Schema (Important Note)

**Current coverage: NRW.** Today the platform covers the **NRW (North Rhine-Westphalia)** region.

**Future scope: whole of Germany.** The platform is designed so that it can be **extended to cover the whole of Germany** — not limited to a single region or federal state. This applies to **all existing and future data sources**: the same Bronze → Silver → Crawler → Catalog flow works regardless of which part of Germany the data comes from, so additional regions and new sources can be onboarded without changing the core pipeline design.

**Required schema must be clearly defined.** For every data source being onboarded, the **required schema** (expected columns and their types) should be defined up front. The **ETL process should prepare the Silver data according to this expected structure.** The **Glue Crawler then discovers and infers the schema from the Silver data** and registers it in the Glue Data Catalog. A stable, agreed schema per domain keeps queries and dashboards reliable as new data arrives.

**Extra columns are fine, but require ETL code changes.** Source systems may provide additional columns beyond the required set. These can be carried through the extraction or ETL process where needed — but this is **not automatic**: adding (or changing) which columns land in the Silver layer requires **code-level changes to the ETL script** for that data source, so the new columns are explicitly selected, cleaned, and written. Once the ETL is updated and the Silver data is prepared with the expected structure, the **Glue Crawler then discovers and registers the updated table schema** on its next run. In short, the crawler reflects whatever structure the ETL produces — it does not add columns on its own.

### Scaling the Platform — Two Scenarios

**Scenario 1 — Expanding an existing data source to all of Germany (no code change needed).**
The current codebase can handle data for the **whole of Germany** for an existing source **without any code changes, as long as the schema stays the same**. The ETL jobs and crawlers operate on the *structure* of the data, not on geography — so additional data from other regions (beyond NRW) simply flows through the same Bronze → Silver → Crawler → Catalog pipeline. The existing German-specific handling in the ETL (e.g. German month-name parsing, umlaut normalization) already applies, so no changes are required to scale coverage.

**Scenario 2 — Onboarding a brand-new data source (new ETL + new crawler needed).**
Adding a completely new data source *does* require development work, in this order:

1. **Identify the schema** — determine what attributes/columns the new source provides and define the required schema (column names and types).
2. **Develop a new ETL script** — write a new Bronze → Silver Glue job for that source (cleaning, standardization, dedup, timestamp/partition handling), following the same pattern as the existing jobs.
3. **Create and run a new crawler** — add a Glue crawler pointed at the new source's `silver/` prefix so its table and schema are registered in the Glue Data Catalog / Lake Formation.
4. **Wire it into the orchestration** — add the new Glue job and crawler to the Step Functions orchestrator (and the `start-glue-crawlers` / `check-glue-crawlers-status` crawler lists) so it runs as part of the daily pipeline.
5. **Set permissions in Lake Formation** — grant the appropriate principals access to the new database/table.

In short: **when the schema stays the same, existing sources scale without code changes; a new source requires building its ETL and crawler, then integrating them into the existing orchestration.**

---

## 7. Component 5 — Lambda Functions

| Lambda | Runtime | Role in Pipeline |
|--------|---------|------------------|
| `BiTech-Data-extractor` | — | Pulls raw source data into Bronze (used by the extraction pipeline). |
| `start-glue-crawlers` | python3.12 | Starts all Glue crawlers. |
| `check-glue-crawlers-status` | python3.12 | Polls crawler states; returns `all_done=true` when none are RUNNING/STOPPING. |
| `bitech-prod-s3-url` | python3.13 | Generates/handles S3 URLs. |
| `bitech-prod` | python3.12 | Core backend Lambda. |

> **Platform Development Note:** As part of the AWS data platform, we also developed supporting Lambda functions to handle platform-specific orchestration and data-access operations. The UI integrates with the AWS platform through the required SDK/API interfaces, while the backend Lambda functions handle the corresponding processing and AWS service interactions.

---

## 8. End-to-End Daily Run (Step by Step)

1. **07:30 UTC** — EventBridge rule `bitech-daily-etl-trigger` fires.
2. It starts the **`bitech-glue-etl-orchestrator`** Step Functions execution.
3. The orchestrator launches **5 Glue jobs in parallel**, each transforming its domain's Bronze CSVs into clean Silver Parquet (partitioned by date).
4. Once the jobs complete, the orchestrator calls **`start-glue-crawlers`**.
5. It then enters a **wait-and-check loop** (`check-glue-crawlers-status`) until every crawler reports done.
6. Crawlers update tables in the **`bitech_prod_db`** Glue Data Catalog.
7. The execution reaches **Success** — data is now fully queryable via **Athena** / BI tools.

---

## 9. Why This Design Works for the Client

- **Fully automated** — one daily schedule drives the entire flow; zero manual steps.
- **Resilient** — retries on Glue jobs and extraction, plus a crawler wait-loop that only finishes when the catalog is truly up to date.
- **Fast** — the five ETL jobs run in parallel instead of one after another.
- **Observable** — every execution and state is visible in the Step Functions console for monitoring and troubleshooting.
- **Consistent & query-ready** — data is marked ready only after Silver is written *and* cataloged, so Athena/BI always sees complete data.

---

## 10. Reference — Pipeline Components

**Region:** `eu-central-1`

- **EventBridge rule:** `bitech-daily-etl-trigger`
- **State machines:** `bitech-glue-etl-orchestrator`, `BiTech-Data-Extraction-Pipeline`
- **Glue jobs:** `etl-job-policy-table`, `glue-etl-prd-crime-data-glue-bronze_to_silver`, `glue-etl-prd-event-data-glue-bronze_to_silver`, `glue-etl-prd-traffic-data-glue-bronze_to_silver`, `glue-prd-weather-data-bronze_silver_v2`
- **Glue / Lake Formation databases:** `bitech_prod_db`, `bitech_staging_db`, `crime-data-db`, `events-data-db`, `insurance-data-db`, `traffic-data-db`, `weather-data-db`
- **Key Lambdas:** `BiTech-Data-extractor`, `start-glue-crawlers`, `check-glue-crawlers-status`

> Internal resource identifiers (account ID, S3 bucket names, IAM users, and IAM role names) are intentionally omitted from this client document. They are available separately to authorized personnel.
