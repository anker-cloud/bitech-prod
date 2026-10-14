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
    for crawler in CRAWLERS:
        glue.start_crawler(Name=crawler)

    return {"status": "started"}