import sys
import logging
from awsglue.transforms import *
from awsglue.utils import getResolvedOptions
from awsglue.context import GlueContext
from pyspark.context import SparkContext
from pyspark.sql.functions import col, udf, year, month, dayofmonth, trim, when
from pyspark.sql.types import TimestampType, IntegerType
from datetime import datetime
from awsglue.dynamicframe import DynamicFrame

logger = logging.getLogger('GlueJobLogger')
logger.setLevel(logging.INFO)
handler = logging.StreamHandler()
formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
handler.setFormatter(formatter)
logger.addHandler(handler)

logger.info("Starting Glue Job: Bronze → Silver ETL with DynamicFrame (Parquet + partition overwrite)")

sc = SparkContext()
glueContext = GlueContext(sc)
spark = glueContext.spark_session

try:

    # ------------------------------
    # S3 Paths
    # ------------------------------
    bronze_path = "s3://bitech-pbac-data-prd/crime-data/bronze/"
    silver_path = "s3://bitech-pbac-data-prd/crime-data/silver/"

    logger.info(f"Reading Bronze data recursively from: {bronze_path}")

    # ------------------------------
    # Step 1: Read Bronze Data as DynamicFrame
    # ------------------------------
    dyf_bronze = glueContext.create_dynamic_frame.from_options(
        connection_type="s3",
        connection_options={"paths": [bronze_path], "recurse": True},
        format="csv",
        format_options={"withHeader": True}
    )

    if dyf_bronze.toDF().limit(1).count() == 0:
        logger.error("No records found in Bronze layer. Aborting job.")
        raise Exception("No input data")

    logger.info(f"Bronze data loaded: {dyf_bronze.count()} rows")

    # ------------------------------
    # Step 2: Rename Columns
    # ------------------------------
    rename_map = {
        "PLZ": "postal_code",
        "City_name": "city_name",
        "Date": "date_time",
        "Title": "title",
        "Link": "link",
        "Description": "description"
    }

    dyf_silver = dyf_bronze
    for old_col, new_col in rename_map.items():
        dyf_silver = dyf_silver.rename_field(old_col, new_col)

    logger.info("Column renaming completed")

    # ------------------------------
    # Step 3: Parse German datetime
    # ------------------------------
    def parse_german_datetime(dt_str):
        if dt_str is None:
            return None
        try:
            date_part, time_part = dt_str.split("|")
            date_part = date_part.strip()
            time_part = time_part.strip()

            months = {
                "Januar": 1, "Februar": 2, "März": 3, "April": 4,
                "Mai": 5, "Juni": 6, "Juli": 7, "August": 8,
                "September": 9, "Oktober": 10, "November": 11, "Dezember": 12
            }

            day, month_name, year_str = date_part.replace(".", "").split(" ")
            month = months.get(month_name, 0)
            if month == 0:
                return None

            hour, minute = time_part.split(":")
            return datetime(int(year_str), month, int(day), int(hour), int(minute))
        except:
            return None

    parse_dt_udf = udf(parse_german_datetime, TimestampType())

    df = dyf_silver.toDF()

    # ------------------------------
    # Convert Empty Strings to NULL
    # ------------------------------
    for c in df.columns:
        df = df.withColumn(c, when(trim(col(c)) == "", None).otherwise(col(c)))
    logger.info("Empty string values converted to NULL")

    # ------------------------------
    # Convert postal_code to Integer
    # ------------------------------
    if "postal_code" in df.columns:
        df = df.withColumn("postal_code", col("postal_code").cast(IntegerType()))
        logger.info("postal_code column converted to Integer")

    # ------------------------------
    # Parse datetime + create partitions
    # ------------------------------
    df = df.withColumn("date_time", parse_dt_udf(col("date_time")))
    df = df.withColumn("year", year(col("date_time"))) \
           .withColumn("month", month(col("date_time"))) \
           .withColumn("day", dayofmonth(col("date_time")))
    logger.info("Date conversion + partition columns created")

    # ------------------------------
    # ✅ Deduplicate — exact duplicates only
    # Removes rows where every single column is identical
    # ------------------------------
    logger.info("Checking for duplicate crime records")
    before_dedup_count = df.count()

    df = df.dropDuplicates()

    after_dedup_count = df.count()
    logger.info(f"Duplicate records removed: {before_dedup_count - after_dedup_count}")
    logger.info(f"After deduplication: {after_dedup_count} records")

    # ------------------------------
    # ✅ Write — overwrite method already correct
    # spark.conf set before write + native Spark writer
    # ------------------------------
    spark.conf.set("spark.sql.sources.partitionOverwriteMode", "dynamic")

    logger.info(f"Writing to Silver path with dynamic overwrite: {silver_path}")

    df.write.mode("overwrite") \
        .partitionBy("year", "month", "day") \
        .parquet(silver_path)

    logger.info("Silver Parquet write completed with dynamic partition overwrite.")
    logger.info("Glue Job finished successfully!")

except Exception as e:
    logger.error("Glue Job FAILED")
    logger.exception(e)
    raise

finally:
    logger.info("Glue Job execution completed")