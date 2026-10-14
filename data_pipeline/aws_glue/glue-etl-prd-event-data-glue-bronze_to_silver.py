import sys
import logging
from awsglue.transforms import *
from awsglue.context import GlueContext
from awsglue.utils import getResolvedOptions
from awsglue.job import Job
from pyspark.context import SparkContext
from pyspark.sql import functions as F
from pyspark.sql.types import StringType, DoubleType, IntegerType, LongType
from awsglue.dynamicframe import DynamicFrame

logger = logging.getLogger()
logger.setLevel(logging.INFO)
handler = logging.StreamHandler()
formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
handler.setFormatter(formatter)
logger.addHandler(handler)

logger.info("Starting Germany Events Silver ETL Job...")

args = getResolvedOptions(sys.argv, ["JOB_NAME"])
sc = SparkContext()
glueContext = GlueContext(sc)
spark = glueContext.spark_session
job = Job(glueContext)
job.init(args["JOB_NAME"], args)

# Must be set BEFORE any write
spark.conf.set("spark.sql.sources.partitionOverwriteMode", "dynamic")

try:

    # -----------------------------
    # S3 Paths
    # -----------------------------
    bronze_path = "s3://bitech-pbac-data-prd/event-data/bronze/"
    silver_path  = "s3://bitech-pbac-data-prd/event-data/silver/"

    logger.info(f"Bronze path: {bronze_path}")
    logger.info(f"Silver path: {silver_path}")

    # -----------------------------
    # Read Full Bronze
    # -----------------------------
    dyf_bronze = glueContext.create_dynamic_frame.from_options(
        connection_type="s3",
        connection_options={"paths": [bronze_path], "recurse": True},
        format="csv",
        format_options={"withHeader": True}
    )

    df = dyf_bronze.toDF()

    if df.limit(1).count() == 0:
        logger.error("No records found in Bronze layer. Aborting job.")
        raise Exception("No input data")

    logger.info(f"Bronze records read: {df.count()}")

    # -----------------------------
    # Clean Column Names
    # -----------------------------
    for c in df.columns:
        df = df.withColumnRenamed(c, c.strip().lower().replace(" ", "_"))
    logger.info("Column names normalized.")

    # -----------------------------
    # Convert Empty Strings to NULL
    # -----------------------------
    for c in df.columns:
        df = df.withColumn(c, F.when(F.trim(F.col(c)) == "", None).otherwise(F.col(c)))
    logger.info("Empty string values converted to NULL")

    # -----------------------------
    # Convert postal_code to Integer safely
    # -----------------------------
    if "postal_code" in df.columns:
        df = df.withColumn(
            "postal_code",
            F.when(F.col("postal_code").rlike("^[0-9]+$"), F.col("postal_code").cast(IntegerType()))
             .otherwise(None)
        )
        logger.info("postal_code converted to Integer safely")

    # -----------------------------
    # Safe Timestamp Parsing
    # -----------------------------
    df = (
        df.withColumn("start_date_local", F.to_timestamp("start_date", "yyyy-MM-dd"))
          .withColumn("end_date_local",   F.to_timestamp("end_date",   "yyyy-MM-dd"))
          .filter(F.col("start_date_local").isNotNull())
    )
    logger.info(f"Valid timestamp records: {df.count()}")

    # -----------------------------
    # Partition Columns
    # -----------------------------
    df = (
        df.withColumn("year",  F.year("start_date_local").cast(StringType()))
          .withColumn("month", F.format_string("%02d", F.month("start_date_local")))
          .withColumn("day",   F.format_string("%02d", F.dayofmonth("start_date_local")))
    )

    # -----------------------------
    # Handle Null Geo
    # -----------------------------
    df = (
        df.withColumn("latitude",  F.coalesce(F.col("latitude").cast(DoubleType()),  F.lit(0.0)))
          .withColumn("longitude", F.coalesce(F.col("longitude").cast(DoubleType()), F.lit(0.0)))
    )

    # -----------------------------------------------------------------------
    # Normalize expected_crowd → clean numeric (Long)
    # "1,200" → 1200 | ">500" / "500+" → 500 | "Over 500,000" → 500000
    # "Unknown" / "Thousands" / "Millions" / "several hundred thousand" → NULL
    # -----------------------------------------------------------------------
    df = df.withColumn(
        "expected_crowd",
        F.when(
            F.lower(F.trim(F.col("expected_crowd"))).isin(
                "unknown", "thousands", "millions", "several hundred thousand"
            ),
            None
        ).otherwise(
            F.regexp_extract(
                F.regexp_replace(
                    F.regexp_replace(F.col("expected_crowd"), "(?i)over\\s*", ""),
                    "[,\\s]", ""
                ),
                "([0-9]+)", 1
            )
        )
    ).withColumn(
        "expected_crowd",
        F.when(F.col("expected_crowd") == "", None)
         .otherwise(F.col("expected_crowd").cast(LongType()))
    )
    logger.info("expected_crowd normalized to numeric (Long), non-parseable values set to NULL")

    # -----------------------------
    # Trim ALL string columns before dedup
    # Invisible whitespace/characters from CSV cause dropDuplicates()
    # to miss rows that look identical but differ at byte level
    # -----------------------------
    string_cols = [f.name for f in df.schema.fields if isinstance(f.dataType, StringType)]
    for c in string_cols:
        df = df.withColumn(c, F.trim(F.col(c)))
    logger.info(f"Trimmed {len(string_cols)} string columns before dedup: {string_cols}")

    # -----------------------------
    # Deduplicate — exact duplicates only
    # Keeps all occurrence statuses (upcoming / ongoing / finished)
    # Only drops rows where every single column is identical
    # -----------------------------
    logger.info("Checking for duplicate event records")
    before_dedup_count = df.count()

    df = df.dropDuplicates()

    after_dedup_count = df.count()
    logger.info(f"Duplicate records removed: {before_dedup_count - after_dedup_count}")
    logger.info(f"After deduplication: {after_dedup_count} records")

    # -----------------------------------------------------------------------
    # Deterministic event_id (SHA-256)
    # Hashed on 6 fields to guarantee a unique ID per row.
    # postal_code, expected_crowd, or occurrence (upcoming/finished/ongoing).
    # All occurrence statuses are intentionally preserved because this data
    # is used for insurance and conflict/riot matching — knowing an event
    # was upcoming, ongoing, or finished on a given date is all critical.
    # -----------------------------------------------------------------------
    df_clean = df.withColumn(
        "event_id",
        F.sha2(
            F.concat_ws("|",
                F.col("event_name"),
                F.col("start_date"),
                F.col("city_name"),
                F.coalesce(F.col("postal_code").cast(StringType()), F.lit("")),
                F.coalesce(F.col("expected_crowd").cast(StringType()), F.lit("")),
                F.coalesce(F.col("occurrence"), F.lit(""))
            ),
            256
        )
    )
    logger.info("event_id generated as SHA-256 hash of event_name, start_date, city_name, postal_code, expected_crowd, occurrence")

    # -----------------------------
    # Repartition
    # -----------------------------
    df_clean = df_clean.repartition("year", "month", "day")
    logger.info("Repartitioned by year/month/day.")

    # -----------------------------
    # Write via native Spark writer
    # Honours spark.sql.sources.partitionOverwriteMode = dynamic
    # -----------------------------
    df_clean.write \
        .mode("overwrite") \
        .partitionBy("year", "month", "day") \
        .option("compression", "snappy") \
        .parquet(silver_path)

    logger.info(f"Silver write complete. Records written: {df_clean.count()}")

except Exception as e:
    logger.error("Germany Events Silver ETL Job FAILED")
    logger.exception(e)
    raise

finally:
    job.commit()
    logger.info("Germany Events Silver ETL Job completed successfully.")