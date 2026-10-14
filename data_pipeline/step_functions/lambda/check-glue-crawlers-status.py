import boto3

glue = boto3.client('glue')

CRAWLERS = [
    "bitech-staging-crime-data",
    "bitech-staging-event-data",
    "bitech-staging-insurance-data",
    "bitech-staging-traffic-data",
    "bitech-staging-weather-data",
    "bitech-prod-crime-data",
    "bitech-prod-event-data",
    "bitech-prod-insurance-data",
    "bitech-prod-traffic-data",
    "bitech-prod-weather-data"
]

def lambda_handler(event, context):
    status_summary = {}
    all_done = True

    for crawler in CRAWLERS:
        response = glue.get_crawler(Name=crawler)
        state = response["Crawler"]["State"]

        status_summary[crawler] = state

        if state in ["RUNNING", "STOPPING"]:
            all_done = False

    return {
        "all_done": all_done,
        "status": status_summary
    }