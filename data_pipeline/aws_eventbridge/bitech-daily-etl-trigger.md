# AWS EventBridge - Bitech ETL Trigger

## Why This EventBridge Rule Was Created

This EventBridge rule was created to **automatically trigger the Bitech Glue ETL pipeline on a daily schedule**, eliminating the need for manual execution. It ensures that the bronze-to-silver data transformation jobs run consistently every day without human intervention.

---

## Rule Configuration

| Field         | Value                                                                     |
|---------------|---------------------------------------------------------------------------|
| Rule Name     | `bitech-daily-etl-trigger`                                                |
| Description   | Daily trigger for Glue ETL pipeline                                       |
| Status        | Enabled                                                                   |
| Type          | Scheduled (Standard)                                                      |
| Event Bus     | `default`                                                                 |
| Region        | `eu-central-1`                                                            |
| Rule ARN      | `arn:aws:events:eu-central-1:072012508476:rule/bitech-daily-etl-trigger`  |

---

## Schedule

- **Cron Expression:** `30 7 * * ? *`
- **Runs daily at:** 07:30 UTC
