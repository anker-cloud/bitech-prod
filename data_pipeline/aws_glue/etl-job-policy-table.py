# -----------------------------
# Policy Data Silver ETL
# -----------------------------

import sys
import re
import logging
from pyspark.context import SparkContext
from awsglue.context import GlueContext
from awsglue.job import Job
from awsglue.utils import getResolvedOptions
from pyspark.sql import functions as F
from pyspark.sql.types import StringType

# -----------------------------
# Logging Setup
# -----------------------------
logger = logging.getLogger('glue_logger')
logger.setLevel(logging.INFO)
handler = logging.StreamHandler()
formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
handler.setFormatter(formatter)
logger.addHandler(handler)

logger.info("Starting Policy Data Silver ETL Job...")

# -----------------------------
# Arguments
# -----------------------------
args = getResolvedOptions(sys.argv, ['JOB_NAME'])

# -----------------------------
# Glue / Spark Context
# -----------------------------
sc = SparkContext()
glueContext = GlueContext(sc)
spark = glueContext.spark_session
job = Job(glueContext)
job.init(args['JOB_NAME'], args)

try:
    # -----------------------------
    # German normalization UDF
    # -----------------------------
    def normalize_german(text):
        if text is None:
            return None
        replacements = {
            'ä':'a', 'ö':'o', 'ü':'u', 'ß':'ss',
            'Ä':'A', 'Ö':'O', 'Ü':'U'
        }
        for k, v in replacements.items():
            text = text.replace(k, v)
        return text.lower()

    normalize_german_udf = F.udf(normalize_german, StringType())

    # -----------------------------
    # Input / Output paths
    # -----------------------------
    bronze_path = "s3://bitech-pbac-data-prd/insurance_data/bronze/"
    silver_path = "s3://bitech-pbac-data-prd/insurance_data/silver/"

    # -----------------------------
    # Read Bronze CSV recursively
    # -----------------------------
    logger.info(f"Reading Bronze data from {bronze_path} recursively")
    df_bronze = (
        spark.read.format("csv")
        .option("header", "true")
        .option("recursiveFileLookup", "true")
        .option("inferSchema", "true")
        .load(bronze_path)
    )

    if df_bronze.limit(1).count() == 0:
        logger.error("No records found in Bronze layer. Aborting job.")
        raise Exception("No input data")

    logger.info(f"Bronze data count: {df_bronze.count()}")

    # -----------------------------
    # Rename columns firstname, lastname, city
    # -----------------------------
    df_renamed = (
        df_bronze
        .withColumnRenamed("firstname", "first_name")
        .withColumnRenamed("lastname", "last_name")
        .withColumnRenamed("city", "city_name")
    )

    # -----------------------------
    # Normalize city_name column
    # -----------------------------
    df_normalized = df_renamed.withColumn(
        "city_name", normalize_german_udf(F.col("city_name"))
    )

    # -----------------------------
    # Convert empty strings to NULL
    # -----------------------------
    for c in df_normalized.columns:
        df_normalized = df_normalized.withColumn(
            c, F.when(F.trim(F.col(c)) == "", None).otherwise(F.col(c))
        )
    logger.info("Empty string values converted to NULL")

    # -----------------------------
    # Extract partition columns from date field (inception_date)
    # Expected format: yyyy-MM-dd
    # -----------------------------
    df_with_partitions = df_normalized.withColumn(
        "year", F.year(F.to_date("inception_date", "yyyy-MM-dd"))
    ).withColumn(
        "month", F.month(F.to_date("inception_date", "yyyy-MM-dd"))
    ).withColumn(
        "day", F.dayofmonth(F.to_date("inception_date", "yyyy-MM-dd"))
    )

    # -----------------------------
    # Optional: Remove rows with null/invalid inception_date
    # -----------------------------
    df_final = df_with_partitions.filter(
        (F.col("year").isNotNull()) & (F.col("month").isNotNull()) & (F.col("day").isNotNull())
    )

    logger.info(f"Filtered valid records for partitioning: {df_final.count()}")

    # -----------------------------
    # Write to Silver layer partitioned by year/month/day as Parquet
    # -----------------------------
    logger.info(f"Writing Silver data to {silver_path} partitioned by year/month/day")

    df_final.write.mode("overwrite") \
        .partitionBy("year", "month", "day") \
        .parquet(silver_path)

    logger.info("Silver layer write completed")

except Exception as e:
    logger.error("Policy Data Silver ETL Job FAILED")
    logger.exception(e)
    raise

finally:
    # -----------------------------
    # Commit Job
    # -----------------------------
    job.commit()
    logger.info("Policy Data Silver ETL Job completed successfully.")