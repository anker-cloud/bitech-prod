import logging
import pandas as pd
import time
import sys
import os
import s3fs
from datetime import datetime

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

# ==============================================================================
# ⚙️ CONFIGURATION (FLAT HELPER PATH)
# ==============================================================================
# We grab the flat path from main.py's environment variable.
OUTPUT_FILE = os.environ.get(
    'CRIME_RAW_FILE_S3', 
    's3://bitech-pbac-data-prd/helper-data/crime-data/crime_data_raw_with_plz.csv'
)

# Used for logging/console messages only
CURRENT_DATE = os.environ.get('CRIME_PARTITION_DATE', datetime.now().strftime('%Y-%m-%d'))

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger()

def get_driver():
    """Configures Chrome for AWS Lambda environment."""
    chrome_options = Options()

    chrome_bin = os.environ.get("CHROME_BIN", "/opt/chrome-linux64/chrome")
    chromedriver_bin = os.environ.get("CHROMEDRIVER_BIN", "/opt/chromedriver-linux64/chromedriver")

    chrome_options.binary_location = chrome_bin
    service = Service(executable_path=chromedriver_bin)

    chrome_options.add_argument("--headless=new")
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")
    chrome_options.add_argument("--disable-gpu")
    chrome_options.add_argument("--single-process")
    chrome_options.add_argument("--window-size=1920,1080")
    chrome_options.add_argument("--user-data-dir=/tmp/user-data")
    chrome_options.add_argument("--data-path=/tmp/data-path")
    chrome_options.add_argument("--homedir=/tmp")
    chrome_options.add_argument("--disk-cache-dir=/tmp/cache-dir")

    try:
        driver = webdriver.Chrome(service=service, options=chrome_options)
        return driver
    except Exception as e:
        logger.error(f"❌ Failed to initialize Chrome Driver: {e}")
        raise

def initialize_s3_file():
    try:
        pd.read_csv(OUTPUT_FILE, nrows=1)
    except:
        logger.info("Initializing base CSV file on S3 with full schema...")
        # ✅ FIX: Updated schema to include Link and Description
        df = pd.DataFrame(columns=['Title', 'Link', 'Description', 'Date', 'Location', 'PLZ'])
        df.to_csv(OUTPUT_FILE, index=False, encoding='utf-8-sig')

def get_existing_count():
    try:
        df = pd.read_csv(OUTPUT_FILE)
        return len(df) if not df.empty else 0
    except:
        return 0

def batch_save_to_s3(new_rows):
    if not new_rows:
        return
    df_new = pd.DataFrame(new_rows)
    try:
        try:
            existing_df = pd.read_csv(OUTPUT_FILE)
            final_df = pd.concat([existing_df, df_new], ignore_index=True)
            # Deduplicate based on Title and Date
            final_df = final_df.drop_duplicates(subset=['Title', 'Date'], keep='first')
        except:
            final_df = df_new
            
        final_df.to_csv(OUTPUT_FILE, index=False, encoding='utf-8-sig')
        logger.info(f"✅ Batch Saved: Added {len(new_rows)} rows. Total S3 records: {len(final_df)}")
    except Exception as e:
        logger.error(f"❌ S3 Batch Write Error: {e}")

# Filter Setup
user_choice = '1'  # '1' = 24h
period_map = {'1': 2, '2': 3, '3': 4, '4': 5}
PERIOD_INDEX = period_map.get(user_choice, 2)

# ==============================================================================
# 🚀 MAIN PROCESS
# ==============================================================================
def run_scraper():
    initialize_s3_file()

    s3_existing_count = get_existing_count()
    logger.info(f"🚀 Starting Headless Scraper for S3 Partition: {CURRENT_DATE}. Already on S3: {s3_existing_count}")

    driver = None
    try:
        driver = get_driver()

        logger.info("Loading webpage...")
        driver.get("https://polizei.nrw/presse/pressemitteilungen")
        time.sleep(3)

        # Cookie Banner
        try:
            driver.find_element(By.XPATH, "//button[contains(text(),'Zustimmen') or contains(text(),'Akzeptieren')]").click()
        except:
            pass

        # Apply Filters
        logger.info("Applying original search filters...")
        driver.find_element(By.XPATH, '/html/body/div[2]/div/div/div[2]/main/section/div/div[1]/form/div/div[2]/div').click()
        time.sleep(1)

        crime_item = driver.find_element(By.XPATH, '/html/body/div[2]/div/div/div[2]/main/section/div/div[1]/form/div/div[2]/div/ul/li[9]')
        driver.execute_script("arguments[0].click();", crime_item)

        driver.find_element(By.XPATH, '/html/body/div[2]/div/div/div[2]/main/section/div/div[1]/form/div/div[1]/a').click()
        time.sleep(1)

        driver.find_element(By.XPATH, '/html/body/div[2]/div/div/div[2]/main/section/div/div[1]/form/div/div[4]/div[6]/div').click()

        period_xpath = f'/html/body/div[2]/div/div/div[2]/main/section/div/div[1]/form/div/div[4]/div[6]/div/ul/li[{PERIOD_INDEX}]'
        driver.find_element(By.XPATH, period_xpath).click()
        time.sleep(2)

        logger.info("Clicking Submit...")
        submit_wrapper = driver.find_element(By.XPATH, '/html/body/div[2]/div/div/div[2]/main/section/div/div[1]/form/div/div[5]/div')
        submit_btn = submit_wrapper.find_element(By.XPATH, ".//input | .//button")
        driver.execute_script("arguments[0].click();", submit_btn)
        time.sleep(6)

        # Scrape Loop
        logger.info("Starting extraction loop...")
        cards_processed_this_session = 0
        extracted_data = []
        previous_card_count = -1

        while True:
            cards = driver.find_elements(By.XPATH, "//div[contains(@class, 'fields-wrapper')]")
            current_card_count = len(cards)

            if current_card_count == previous_card_count:
                logger.info(f"🏁 No new cards loaded. Reached end of results. Extracted {len(extracted_data)} records.")
                break

            previous_card_count = current_card_count

            if current_card_count > cards_processed_this_session:
                for i in range(cards_processed_this_session, current_card_count):
                    card = cards[i]
                    try:
                        row = {}
                        
                        # Title
                        try:
                            row['Title'] = card.find_element(By.XPATH, ".//h2").text.strip()
                        except:
                            row['Title'] = None
                            
                        # ✅ NEW: Link
                        try:
                            row['Link'] = card.find_element(By.XPATH, ".//h2[@class='field-title']/a").get_attribute('href')
                        except:
                            row['Link'] = None
                            
                        # ✅ NEW: Description
                        try:
                            row['Description'] = card.find_element(By.XPATH, ".//div[@class='field-teaser']").text.strip()
                        except:
                            row['Description'] = None
                            
                        # Date
                        try:
                            row['Date'] = card.find_element(By.XPATH, ".//time").text.strip()
                        except:
                            row['Date'] = None

                        # Location & PLZ
                        try:
                            loc_text = card.find_element(By.XPATH, ".//div[@class='combined-location']").text.strip()
                            if " | PLZ:" in loc_text:
                                p = loc_text.split(" | PLZ:")
                                row['Location'], row['PLZ'] = p[0].strip(), p[1].strip()
                            else:
                                row['Location'], row['PLZ'] = loc_text, None
                        except:
                            row['Location'], row['PLZ'] = None, None

                        # Only append if we actually got a title
                        if row['Title']:
                            extracted_data.append(row)
                            
                    except Exception as inner_e:
                        continue

                cards_processed_this_session = current_card_count

            # Pagination
            try:
                sm_btn = driver.find_element(By.XPATH, '/html/body/div[2]/div/div/div[2]/main/section/div/div[3]/div/div/nav/ul/li/a')
                driver.execute_script("arguments[0].click();", sm_btn)
                time.sleep(4)
            except:
                logger.info(f"🏁 'Load More' button not found. Reached end. Extracted {len(extracted_data)} records.")
                break

        if extracted_data:
            batch_save_to_s3(extracted_data)
        else:
            logger.info("⚠️ No data was extracted during this run.")

    except Exception as e:
        logger.error(f"❌ Scraper Failed: {e}")
        raise
    finally:
        if driver:
            logger.info("🧹 Closing Chrome Driver...")
            driver.quit()

if __name__ == "__main__":
    run_scraper()