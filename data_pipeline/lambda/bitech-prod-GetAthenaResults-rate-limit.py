import json
import boto3
from botocore.exceptions import ClientError
import urllib.parse
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

# -----------------------------
# Configuration
# -----------------------------
AWS_ACCOUNT_ID = "072012508476"

IAM_ROLE_ARNS = {
    "analyst": f"arn:aws:iam::{AWS_ACCOUNT_ID}:role/bitech_risk_analyst_role",
    "marketing": f"arn:aws:iam::{AWS_ACCOUNT_ID}:role/bitech_marketing_role"
}

ALLOWED_GROUPS = set(IAM_ROLE_ARNS.keys())
PAGE_SIZE = 1000


def lambda_handler(event, context):

    kpi_log = {
        "requestId": context.aws_request_id,
        "apiEndpoint": "Get_Athena_Results",
        "userName": None,
        "logicalRole": None,
        "queryExecutionId": None,
        "status": "PENDING"
    }

    try:
        # =====================================================
        # STEP 1: Identity & PBAC Role
        # =====================================================
        claims = event.get("requestContext", {}).get("authorizer", {}).get("claims", {})
        user_name = claims.get("email") or claims.get("cognito:username")
        groups_raw = claims.get("cognito:groups", [])

        if isinstance(groups_raw, str):
            user_groups = [g.strip() for g in groups_raw.split(",")]
        else:
            user_groups = [g.strip() for g in groups_raw]

        matched_roles = [g for g in user_groups if g in ALLOWED_GROUPS]
        if not user_name or len(matched_roles) != 1:
            return _error_response(403, "User must belong to exactly one authorized role.")

        logical_role = matched_roles[0]
        kpi_log["userName"] = user_name
        kpi_log["logicalRole"] = logical_role

        # =====================================================
        # STEP 2: Request Parameters
        # =====================================================
        params = event.get("queryStringParameters") or {}
        query_execution_id = params.get("queryExecutionId")
        next_token_raw = params.get("nextToken")

        if not query_execution_id:
            return _error_response(400, "Missing queryExecutionId")

        kpi_log["queryExecutionId"] = query_execution_id
        next_token = urllib.parse.unquote(next_token_raw) if next_token_raw else None

        # =====================================================
        # STEP 3: Assume Role
        # =====================================================
        assumed = sts_client.assume_role(
            RoleArn=IAM_ROLE_ARNS[logical_role],
            RoleSessionName=f"AthenaResults-{user_name[:32]}"
        )

        creds = assumed["Credentials"]

        athena = boto3.client(
            "athena",
            aws_access_key_id=creds["AccessKeyId"],
            aws_secret_access_key=creds["SecretAccessKey"],
            aws_session_token=creds["SessionToken"]
        )

        # =====================================================
        # STEP 4: Query Status & Results
        # =====================================================
        status = athena.get_query_execution(QueryExecutionId=query_execution_id)
        state = status["QueryExecution"]["Status"]["State"]

        if state == "SUCCEEDED":
            kwargs = {"QueryExecutionId": query_execution_id, "MaxResults": PAGE_SIZE}
            if next_token:
                kwargs["NextToken"] = next_token

            result = athena.get_query_results(**kwargs)

            columns = [c["Label"] for c in result["ResultSet"]["ResultSetMetadata"]["ColumnInfo"]]
            rows = []
            raw_rows = result["ResultSet"]["Rows"]

            start = 1 if not next_token else 0  # skip header only once
            for row in raw_rows[start:]:
                values = [v.get("VarCharValue") for v in row["Data"]]
                rows.append(dict(zip(columns, values)))

            encoded_token = urllib.parse.quote(result.get("NextToken")) if result.get("NextToken") else None
            kpi_log["status"] = "COMPLETED"

            return {
                "statusCode": 200,
                "headers": {"Content-Type": "application/json"},
                "body": json.dumps({
                    "rowsReturned": len(rows),
                    "nextToken": encoded_token,
                    "userName": user_name,
                    "role": logical_role,
                    "results": rows
                })
            }

        if state in ["FAILED", "CANCELLED"]:
            reason = status["QueryExecution"]["Status"].get("StateChangeReason", "Unknown")
            kpi_log["status"] = state

            # -----------------------------
            # Lake Formation friendly error
            # -----------------------------
            lf_error_indicators = [
                "AccessDeniedException",
                "not authorized",
                "Relation contains no accessible columns",
                "UNAUTHORIZED"
            ]

            if any(x in reason for x in lf_error_indicators):
                return _error_response(
                    403,
                    "Access Denied !! You do not have Lake Formation Permissions to access this table."
                )

            # fallback to original error
            return _error_response(400, f"Query {state}: {reason}")

        kpi_log["status"] = state
        return {
            "statusCode": 202,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"status": state})
        }

    except Exception as e:
        logger.exception("Get Athena Results failed")
        return _error_response(500, str(e))

    finally:
        logger.info(json.dumps(kpi_log))


def _error_response(code, message):
    return {
        "statusCode": code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps({"message": message})
    }
