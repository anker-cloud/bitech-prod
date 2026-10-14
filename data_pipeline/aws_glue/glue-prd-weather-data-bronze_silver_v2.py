import sys
import logging
from pyspark.context import SparkContext
from pyspark.sql import functions as F
from awsglue.context import GlueContext
from awsglue.job import Job
from awsglue.dynamicframe import DynamicFrame
from awsglue.utils import getResolvedOptions

args = getResolvedOptions(sys.argv, ["JOB_NAME"])

sc = SparkContext()
glueContext = GlueContext(sc)
spark = glueContext.spark_session
job = Job(glueContext)
job.init(args["JOB_NAME"], args)

# FIX 1: Set BEFORE any write
spark.conf.set("spark.sql.sources.partitionOverwriteMode", "dynamic")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s"
)
logger = logging.getLogger(__name__)

logger.info("Weather Bronze → Silver Glue Job Started")

try:

    # ----------------------------
    # S3 Paths
    # ----------------------------
    BRONZE_PATH = "s3://bitech-pbac-data-prd/weather-data/bronze/"
    SILVER_PATH = "s3://bitech-pbac-data-prd/weather-data/silver/"

    logger.info(f"Bronze Path: {BRONZE_PATH}")
    logger.info(f"Silver Path: {SILVER_PATH}")

    # ----------------------------
    # Read Bronze Layer (Recursive CSV)
    # ----------------------------
    bronze_dyf = glueContext.create_dynamic_frame.from_options(
        connection_type="s3",
        format="csv",
        connection_options={
            "paths": [BRONZE_PATH],
            "recurse": True
        },
        format_options={
            "withHeader": True,
            "separator": ","
        }
    )

    if bronze_dyf.toDF().limit(1).count() == 0:
        logger.warning("No records found in Bronze layer")
        job.commit()
        sys.exit(0)

    logger.info("Records detected in Bronze layer")

    # ----------------------------
    # Convert to DataFrame
    # ----------------------------
    df = bronze_dyf.toDF()

    # ----------------------------
    # Convert Empty Strings to NULL
    # ----------------------------
    for col_name in df.columns:
        df = df.withColumn(
            col_name,
            F.when(F.trim(F.col(col_name)) == "", None).otherwise(F.col(col_name))
        )
    logger.info("Empty string values converted to NULL")

    # ----------------------------
    # Convert postal_code to Integer
    # ----------------------------
    if "postal_code" in df.columns:
        df = df.withColumn("postal_code", F.col("postal_code").cast("int"))
        logger.info("postal_code column converted to Integer")

    # ----------------------------
    # Timestamp Handling + Partitions
    # ----------------------------
    df = (
        df
        .withColumn(
            "event_timestamp",
            F.to_timestamp("date", "yyyy-MM-dd HH:mm:ssXXX")
        )
        .withColumn("year", F.year("event_timestamp"))
        .withColumn("month", F.month("event_timestamp"))
        .withColumn("day", F.dayofmonth("event_timestamp"))
        .drop("date")
    )
    logger.info("Timestamp conversion and partition columns created")

    # FIX 2: Drop NULL timestamps BEFORE dedup
    invalid_before = df.filter(F.col("event_timestamp").isNull())
    if invalid_before.limit(1).count() > 0:
        logger.warning("Records with NULL timestamp detected and will be dropped")

    df = df.filter(F.col("event_timestamp").isNotNull())

    # ----------------------------
    # Deduplicate
    # ----------------------------
    logger.info("Checking for duplicate weather records")
    before_dedup_count = df.count()

    df = df.dropDuplicates([
        "city_name",
        "latitude",
        "longitude",
        "event_timestamp"
    ])

    after_dedup_count = df.count()
    logger.info(f"Duplicate records removed: {before_dedup_count - after_dedup_count}")
    logger.info(f"After deduplication: {after_dedup_count} records")

    # ----------------------------
    # Repartition
    # ----------------------------
    df = df.repartition("year", "month", "day")

    # ----------------------------
    # Write Silver Layer — dynamic partition overwrite
    # ----------------------------
    (
        df.write
        .mode("overwrite")
        .format("parquet")
        .partitionBy("year", "month", "day")
        .save(SILVER_PATH)
    )

    logger.info("Silver layer write completed")
    job.commit()
    logger.info("Glue Job Finished Successfully")

except Exception as e:
    logger.error("Glue Job Failed")
    logger.exception(e)
    raise

finally:
    logger.info("Glue Job Execution Completed")