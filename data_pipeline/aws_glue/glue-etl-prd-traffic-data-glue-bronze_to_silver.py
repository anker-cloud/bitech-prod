import sys
import logging
from awsglue.context import GlueContext
from awsglue.utils import getResolvedOptions
from awsglue.job import Job
from pyspark.context import SparkContext
from pyspark.sql import functions as F
from pyspark.sql.functions import split, lpad, col

logger = logging.getLogger()
logger.setLevel(logging.INFO)
logger.info("================================================")
logger.info("Starting Traffic Silver ETL Job")
logger.info("================================================")

args = getResolvedOptions(sys.argv, ["JOB_NAME"])
sc = SparkContext()
glueContext = GlueContext(sc)
spark = glueContext.spark_session
job = Job(glueContext)
job.init(args["JOB_NAME"], args)

# Must be set BEFORE any write
spark.conf.set("spark.sql.sources.partitionOverwriteMode", "dynamic")

try:

    # ----------------------------
    # S3 Paths
    # ----------------------------
    bronze_path = "s3://bitech-pbac-data-prd/traffic-data/bronze/"
    silver_path = "s3://bitech-pbac-data-prd/traffic-data/silver/"

    logger.info(f"Bronze Path: {bronze_path}")
    logger.info(f"Silver Path: {silver_path}")

    # ----------------------------
    # Read Bronze CSVs
    # ----------------------------
    df = (
        spark.read.format("csv")
        .option("header", True)
        .option("inferSchema", True)
        .option("recursiveFileLookup", True)
        .load(bronze_path)
    )

    total_records = df.count()
    logger.info(f"Total records fetched from Bronze: {total_records}")
    if total_records == 0:
        logger.error("Bronze layer empty. Aborting job.")
        raise Exception("No input data")

    # ----------------------------
    # Convert Empty Strings to NULL (Data Cleaning)
    # ----------------------------
    for c in df.columns:
        df = df.withColumn(
            c,
            F.when(F.trim(F.col(c)) == "", None).otherwise(F.col(c))
        )

    logger.info("Empty string values converted to NULL")

    # ----------------------------
    # Clean Column Names
    # ----------------------------
    for c in df.columns:
        df = df.withColumnRenamed(c, c.strip().lower().replace(" ", "_"))

    # ----------------------------
    # Standardize Schema
    # ----------------------------
    df = (
        df.withColumnRenamed("isblocked", "is_blocked")
          .withColumnRenamed("lat", "latitude")
          .withColumnRenamed("lon", "longitude")
    )

    # ----------------------------
    # Robust Timestamp Handling
    # ----------------------------
    df = df.withColumn("hour", lpad(split("start_time", ":")[0], 2, "0").cast("int")) \
           .withColumn("minute", split("start_time", ":")[1].cast("int")) \
           .withColumn("second", split("start_time", ":")[2].cast("int"))

    df = df.withColumn("time_seconds", col("hour")*3600 + col("minute")*60 + col("second"))
    df = df.withColumn("start_date_ts", F.to_timestamp("start_date", "yyyy-MM-dd"))
    df = df.withColumn(
        "event_timestamp",
        F.from_unixtime(F.unix_timestamp("start_date_ts") + col("time_seconds")).cast("timestamp")
    )

    valid_ts = df.filter(F.col("event_timestamp").isNotNull()).count()
    invalid_ts = total_records - valid_ts
    logger.info(f"Records with valid event_timestamp: {valid_ts}")
    logger.warning(f"Records with invalid event_timestamp: {invalid_ts}")
    if valid_ts == 0:
        logger.error("Timestamp parsing failed for all records.")
        raise Exception("Timestamp parsing failed")

    df = df.filter(F.col("event_timestamp").isNotNull())

    # ----------------------------
    # Create Partition Columns
    # ----------------------------
    df = df.withColumn("year", F.year("event_timestamp").cast("string")) \
           .withColumn("month", F.format_string("%02d", F.month("event_timestamp"))) \
           .withColumn("day", F.format_string("%02d", F.dayofmonth("event_timestamp")))

    null_parts = df.filter(col("year").isNull() | col("month").isNull() | col("day").isNull()).count()
    if null_parts > 0:
        logger.error("NULL partition values detected. Aborting job.")
        raise Exception("Partition validation failed")
    logger.info("Partition validation passed")

    # ----------------------------
    # Deduplicate Records
    # ----------------------------
    pre_dedup_count = df.count()
    df = df.dropDuplicates(["event_timestamp", "latitude", "longitude", "highway", "identifier"])
    post_dedup_count = df.count()
    duplicates_removed = pre_dedup_count - post_dedup_count
    logger.info(f"Duplicates removed: {duplicates_removed}")
    logger.info(f"Records after deduplication: {post_dedup_count}")

    # ----------------------------
    # Write to Silver Layer
    # ----------------------------
    logger.info("Writing Silver layer to S3...")

    (df.write
       .mode("overwrite")
       .partitionBy("year", "month", "day")
       .option("compression", "snappy")
       .parquet(silver_path)
    )

    logger.info(f"Final records written to Silver: {df.count()}")
    logger.info("Silver layer write successful")

    # ----------------------------
    # Finalize Job
    # ----------------------------
    job.commit()
    logger.info("================================================")
    logger.info("Traffic Silver ETL Job COMPLETED SUCCESSFULLY")
    logger.info("================================================")

except Exception as e:
    logger.error("Traffic Silver ETL Job FAILED")
    logger.exception(e)
    raise

finally:
    logger.info("Traffic Glue Job Execution Finished")