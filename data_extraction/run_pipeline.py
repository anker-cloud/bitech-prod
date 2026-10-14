import subprocess
import os
import sys

def log(msg):
    print(f"DEBUG: {msg}", flush=True)

# --- CONFIGURATION ---
BASE_OUTPUT_PATH = '/tmp/BiTech' if os.environ.get('AWS_LAMBDA_FUNCTION_NAME') else os.getcwd()

def setup_directories():
    log("Initializing temp directories...")
    directories = [
        "Crime_Module/pre-process-files",
        "Weather_Module/pre-process-files",
    ]
    for folder in directories:
        os.makedirs(os.path.join(BASE_OUTPUT_PATH, folder), exist_ok=True)

def run_module(module_name, script_name):
    log(f"Starting Module: {module_name}...")
    script_path = os.path.join(os.getcwd(), module_name, script_name)
    
    if not os.path.exists(script_path):
        log(f"SKIPPING: {script_path} not found.")
        return

    env = os.environ.copy()
    env['PYTHONPATH'] = f"{os.getcwd()}:{env.get('PYTHONPATH', '')}"
    env['BIT_ECH_OUTPUT_ROOT'] = BASE_OUTPUT_PATH

    try:
        subprocess.run([sys.executable, script_path], check=True, env=env, capture_output=False)
        log(f"SUCCESS: {module_name} finished.")
    except subprocess.CalledProcessError as e:
        log(f"ERROR in {module_name}: {e}")
        # CRITICAL: We must raise the error so AWS Step Functions knows the task failed
        raise Exception(f"Module {module_name} failed with exit code {e.returncode}")

def handler(event, context):
    """
    AWS Lambda entry point for Step Functions.
    Expects payload format: {"step": "traffic"}
    """
    setup_directories()
    
    # Extract the step from the Step Function payload (default to 'all' for manual testing)
    step = event.get('step', 'all').lower()
    
    log(f"=== STEP FUNCTION TRIGGERED: {step.upper()} ===")

    try:
        if step == 'traffic':
            run_module("Traffic_Module", "main.py")
        elif step == 'events':
            run_module("Events_Module", "main.py")
        elif step == 'crime':
            run_module("Crime_Module", "main.py")
        elif step == 'weather':
            run_module("Weather_Module", "main.py")
        elif step == 'all':
            # Fallback mode: If you click "Test" in the Lambda console without a payload
            log("Running all modules sequentially (Fallback/Manual Mode).")
            run_module("Traffic_Module", "main.py")
            run_module("Events_Module", "main.py")
            run_module("Crime_Module", "main.py")
            run_module("Weather_Module", "main.py")
        else:
            raise ValueError(f"Unknown step provided in payload: {step}")

        return {'statusCode': 200, 'body': f'{step.upper()} completed successfully.'}

    except Exception as e:
        log(f"FATAL ERROR in {step}: {str(e)}")
        # CRITICAL: Raise the error to trigger the Step Function's "Retry" or "Fail" state
        raise Exception(f"Pipeline failed at step {step}: {str(e)}")

if __name__ == "__main__":
    # For local testing via command line
    handler({"step": "all"}, None)


# import subprocess
# import os
# import sys

# def log(msg):
#     print(f"DEBUG: {msg}", flush=True)

# # --- CONFIGURATION ---
# # Modules write directly to S3 via s3fs — no local upload step needed.
# # BASE_OUTPUT_PATH is kept only for setup_directories() which preps any
# # temp folders a module might still need during processing.
# BASE_OUTPUT_PATH = '/tmp/BiTech' if os.environ.get('AWS_LAMBDA_FUNCTION_NAME') else os.getcwd()

# def setup_directories():
#     log("Initializing temp directories...")
#     directories = [
#         "Crime_Module/pre-process-files",
#         "Weather_Module/pre-process-files",
#     ]
#     for folder in directories:
#         os.makedirs(os.path.join(BASE_OUTPUT_PATH, folder), exist_ok=True)

# def run_module(module_name, script_name):
#     log(f"Starting Module: {module_name}...")
#     script_path = os.path.join(os.getcwd(), module_name, script_name)
#     if not os.path.exists(script_path):
#         log(f"SKIPPING: {script_path} not found.")
#         return

#     env = os.environ.copy()
#     env['PYTHONPATH'] = f"{os.getcwd()}:{env.get('PYTHONPATH', '')}"
#     env['BIT_ECH_OUTPUT_ROOT'] = BASE_OUTPUT_PATH

#     try:
#         subprocess.run([sys.executable, script_path], check=True, env=env, capture_output=False)
#         log(f"SUCCESS: {module_name} finished.")
#     except subprocess.CalledProcessError as e:
#         log(f"ERROR in {module_name}: {e}")

# def main():
#     log("=== PIPELINE STARTING ===")
#     setup_directories()

#     modules = [
#         ("Traffic_Module", "main.py"),
#         ("Events_Module", "main.py"),
#         ("Crime_Module", "main.py"),
#         ("Weather_Module", "main.py"),
#     ]

#     for mod_dir, script in modules:
#         run_module(mod_dir, script)

#     log("=== PIPELINE FINISHED ===")

# def handler(event, context):
#     try:
#         main()
#         return {'statusCode': 200, 'body': 'Pipeline completed successfully.'}
#     except Exception as e:
#         log(f"FATAL ERROR: {str(e)}")
#         return {'statusCode': 500, 'body': str(e)}

# if __name__ == "__main__":
#     main()