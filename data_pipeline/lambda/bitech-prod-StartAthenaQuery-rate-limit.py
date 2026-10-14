import json
import boto3
from botocore.exceptions import ClientError
import re
import logging

# -----------------------------
# Logger Setup
# -----------------------------
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# -----------------------------
# AWS Clients
# -----------------------------
sts_client = boto3.client("sts")
s3_client = boto3.client("s3")

# -----------------------------
# Configuration
# -----------------------------
AWS_ACCOUNT_ID = "072012508476"

# Logical Role → IAM Role mapping (PBAC entry point)
IAM_ROLE_ARNS = {
    "analyst": f"arn:aws:iam::{AWS_ACCOUNT_ID}:role/bitech_risk_analyst_role",
    "marketing": f"arn:aws:iam::{AWS_ACCOUNT_ID}:role/bitech_marketing_role"
}

# Allowed logical roles (defensive check)
ALLOWED_GROUPS = set(IAM_ROLE_ARNS.keys())

# -----------------------------
# Mapping file location in S3
# -----------------------------
MAPPING_BUCKET = "bitech-pbac-data-prd"
MAPPING_KEY = "mapping_file/lambda_mapping.json"

# Athena output location (must be writable by assumed roles)
ATHENA_OUTPUT_BUCKET = "s3://bitech-pbac-data-prd/athena-post-op/"

# -----------------------------
# Load Glue resource registry from S3
# -----------------------------
def load_glue_resources():
    try:
        response = s3_client.get_object(
            Bucket=MAPPING_BUCKET,
            Key=MAPPING_KEY
        )

        content = response["Body"].read().decode("utf-8")
        mapping_data = json.loads(content)

        return mapping_data

    except ClientError as e:
        logger.error(f"Failed to load mapping file from S3: {str(e)}")
        raise

# -----------------------------
# Utility: sanitize filter inputs
# -----------------------------
def sanitize_filter(value: str) -> str:
    if not re.match(r"^[\w\s\-\u00C0-\u017F]+$", value, re.UNICODE):
        raise ValueError("Invalid characters in filter value")
    return value

# -----------------------------
# Utility: normalize German characters
# -----------------------------
def normalize_german(text: str) -> str:
    replacements = {
        'ä':'a', 'ö':'o', 'ü':'u', 'ß':'ss',
        'Ä':'A', 'Ö':'O', 'Ü':'U'
    }
    for k, v in replacements.items():
        text = text.replace(k, v)
    return text.lower()


def lambda_handler(event, context):

    # -----------------------------
    # KPI / Audit Log
    # -----------------------------
    kpi_log = {
        "requestId": context.aws_request_id,
        "apiEndpoint": "Start_Athena_Query",
        "userName": None,
        "logicalRole": None,
        "assumedRoleArn": None,
        "query": None,
        "queriedTables": [],
        "queryExecutionId": None,
        "status": "PENDING",
        "errorMessage": None,
        "cityName": None,
        "postalCode": None
    }

    try:

        # Load Glue resources dynamically from S3 mapping file
        GLUE_RESOURCES = load_glue_resources()

        # =====================================================
        # STEP 1: Identity Extraction (Cognito + PBAC)
        # =====================================================
        claims = event.get("requestContext", {}).get("authorizer", {}).get("claims", {})
        user_name = claims.get("email") or claims.get("cognito:username")
        groups_raw = claims.get("cognito:groups", [])

        if isinstance(groups_raw, str):
            user_groups = [g.strip() for g in groups_raw.split(",")]
        else:
            user_groups = [g.strip() for g in groups_raw]

        # Enforce exactly one valid logical role
        matched_roles = [g for g in user_groups if g in ALLOWED_GROUPS]
        if not user_name or len(matched_roles) != 1:
            return _error_response(403, "User must belong to exactly one authorized role.")

        logical_role = matched_roles[0]
        kpi_log["userName"] = user_name
        kpi_log["logicalRole"] = logical_role

        # =====================================================
        # STEP 2: Parse Request Body (SQL)
        # =====================================================
        body = json.loads(event.get("body", "{}")) if isinstance(event.get("body"), str) else event.get("body", {})
        query = body.get("query")

        if not query:
            return _error_response(400, "Missing 'query' in request body.")

        original_query = query.strip().rstrip(";")
        modified_query = original_query
        kpi_log["query"] = original_query

        # =====================================================
        # STEP 3: Extract Tables (FROM / JOIN)
        # =====================================================
        tables = re.findall(r"(?:FROM|JOIN)\s+([`\"]?[\w\d_.-]+[`\"]?)", original_query, re.IGNORECASE)
        table_names = [t.replace("`", "").replace('"', "").split(".")[-1].lower() for t in tables]

        if not table_names:
            return _error_response(400, "Query must contain FROM or JOIN clause.")

        for table in table_names:
            if table not in GLUE_RESOURCES:
                return _error_response(404, f"Resource '{table}' is not registered.")

        kpi_log["queriedTables"] = table_names

        # =====================================================
        # STEP 3B: Fully Dynamic Join Column Detection
        # =====================================================
        if len(table_names) > 1:

            # Extract table aliases
            alias_pattern = re.findall(
                r"(?:FROM|JOIN)\s+[\w\d_.-]+\s+(\w+)",
                original_query,
                re.IGNORECASE
            )
            if not alias_pattern or len(alias_pattern) != len(table_names):
                alias_pattern = [f"t{i+1}" for i in range(len(table_names))]

            base_alias = alias_pattern[0]

            # Determine join column: check WHERE for equality, fallback to common column if exists
            where_match = re.search(r"\bWHERE\s+([\w\.]+)\s*=", original_query, re.IGNORECASE)
            if where_match:
                detected_column = where_match.group(1).split(".")[-1]
            else:
                # fallback: use first column named the same in all tables
                # for simplicity, we assume 'city_name' exists in all tables
                detected_column = "city_name"

            join_conditions = []
            for alias in alias_pattern[1:]:
                join_conditions.append(f"{base_alias}.{detected_column} = {alias}.{detected_column}")

            enforced_join = " AND ".join(join_conditions)

            if " on " in original_query.lower():
                modified_query = re.sub(
                    r"\bON\b",
                    f"ON {enforced_join} AND ",
                    original_query,
                    flags=re.IGNORECASE
                )
            else:
                # if no ON clause, inject it automatically
                modified_query = re.sub(
                    r"(JOIN\s+[\w\d_.-]+\s+\w+)",
                    rf"\1 ON {enforced_join}",
                    modified_query,
                    flags=re.IGNORECASE
                )

        # =====================================================
        # STEP 4: Optional Dynamic Filters
        # =====================================================
        params = event.get("queryStringParameters") or {}
        city_name = params.get("city_name")
        postal_code = params.get("postal_code")

        kpi_log["cityName"] = city_name
        kpi_log["postalCode"] = postal_code

        filters = []
        display_filters = []

        if city_name:
            safe_city = sanitize_filter(city_name)
            normalized_city = normalize_german(safe_city)

            # automatically apply city filter to t1 (first table alias) if join exists
            target_column = f"{alias_pattern[0]}.city_name" if len(table_names) > 1 else "city_name"
            filters.append(
                f"lower(replace(replace(replace(replace({target_column},'ä','a'),'ö','o'),'ü','u'),'ß','ss')) = '{normalized_city}'"
            )
            display_filters.append(f"city_name = '{safe_city}'")

        if postal_code:
            safe_postal = sanitize_filter(postal_code)
            filters.append(f"postal_code = '{safe_postal}'")
            display_filters.append(f"postal_code = '{safe_postal}'")

        display_query = modified_query

        if filters:
            filter_clause = " AND ".join(filters)
            display_clause = " AND ".join(display_filters)

            lowered = modified_query.lower()
            if "where" in lowered:
                modified_query = re.sub(r"where", f"WHERE {filter_clause} AND ", modified_query, flags=re.IGNORECASE)
                display_query = re.sub(r"where", f"WHERE {display_clause} AND ", display_query, flags=re.IGNORECASE)
            elif "limit" in lowered:
                modified_query = re.sub(r"limit", f"WHERE {filter_clause} LIMIT", modified_query, flags=re.IGNORECASE)
                display_query = re.sub(r"limit", f"WHERE {display_clause} LIMIT", display_query, flags=re.IGNORECASE)
            else:
                modified_query = f"{modified_query} WHERE {filter_clause}"
                display_query = f"{display_query} WHERE {display_clause}"

        # =====================================================
        # STEP 5: Assume Role & Start Athena Query
        # =====================================================
        assumed = sts_client.assume_role(
            RoleArn=IAM_ROLE_ARNS[logical_role],
            RoleSessionName=f"AthenaStart-{user_name[:32]}"
        )

        creds = assumed["Credentials"]
        kpi_log["assumedRoleArn"] = assumed["AssumedRoleUser"]["Arn"]

        athena = boto3.client(
            "athena",
            aws_access_key_id=creds["AccessKeyId"],
            aws_secret_access_key=creds["SecretAccessKey"],
            aws_session_token=creds["SessionToken"]
        )

        # For multi-database support, prepend each table with its Glue database
        for tbl in GLUE_RESOURCES:
            db = GLUE_RESOURCES[tbl]["database_name"]
            modified_query = re.sub(
                rf"\b{tbl}\b",
                f'"{db}".{tbl}',
                modified_query,
                flags=re.IGNORECASE
            )
            display_query = re.sub(
                rf"\b{tbl}\b",
                f'{tbl}',
                display_query,
                flags=re.IGNORECASE
            )

        response = athena.start_query_execution(
            QueryString=modified_query,
            QueryExecutionContext={
                "Database": "default",
                "Catalog": "AwsDataCatalog"
            },
            WorkGroup="marketing_workgroup-lf",
            ResultConfiguration={"OutputLocation": ATHENA_OUTPUT_BUCKET}
        )

        kpi_log["queryExecutionId"] = response["QueryExecutionId"]
        kpi_log["status"] = "STARTED"

        return {
            "statusCode": 202,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({
                "message": "Query started successfully.",
                "queryExecutionId": response["QueryExecutionId"],
                "userName": user_name,
                "role": logical_role,
                "finalQuery": display_query
            })
        }

    except Exception as e:
        kpi_log["status"] = "FAILED"
        kpi_log["errorMessage"] = str(e)
        logger.exception("Start Athena Query failed")
        return _error_response(500, str(e))

    finally:
        logger.info(json.dumps(kpi_log))


def _error_response(code, message):
    return {
        "statusCode": code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps({"message": message})
    }