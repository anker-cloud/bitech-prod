# 1. Use the official AWS Lambda Python 3.12 base image
FROM public.ecr.aws/lambda/python:3.12

# 2. Install system dependencies for Headless Chrome
RUN dnf install -y atk cups-libs gtk3 libXcomposite alsa-lib \
    libXcursor libXdamage libXext libXi libXrandr libXScrnSaver \
    libXtst pango at-spi2-atk libXt xorg-x11-server-Xvfb \
    xorg-x11-xauth dbus-glib nss mesa-libgbm jq unzip && \
    dnf clean all

# 3. Install Chrome for Testing and ChromeDriver (pinned to matching versions)
RUN curl -Lo "/tmp/chromedriver-linux64.zip" "https://storage.googleapis.com/chrome-for-testing-public/122.0.6261.94/linux64/chromedriver-linux64.zip" && \
    curl -Lo "/tmp/chrome-linux64.zip" "https://storage.googleapis.com/chrome-for-testing-public/122.0.6261.94/linux64/chrome-linux64.zip" && \
    unzip /tmp/chromedriver-linux64.zip -d /opt/ && \
    unzip /tmp/chrome-linux64.zip -d /opt/ && \
    rm /tmp/*.zip

# 4. Set Environment Variables for Selenium
ENV CHROME_BIN=/opt/chrome-linux64/chrome
ENV CHROMEDRIVER_BIN=/opt/chromedriver-linux64/chromedriver

# 5. Copy project files
COPY . ${LAMBDA_TASK_ROOT}

# 6. Install Python dependencies
RUN pip install --upgrade pip
RUN pip install --no-cache-dir -r requirements.txt

# 7. Set the entry point to the Lambda handler
CMD [ "run_pipeline.handler" ]

# # 1. Use the official AWS Lambda Python 3.12 base image
# FROM public.ecr.aws/lambda/python:3.12

# # 2. Install system dependencies for Headless Chrome
# RUN dnf install -y atk cups-libs gtk3 libXcomposite alsa-lib \
#     libXcursor libXdamage libXext libXi libXrandr libXScrnSaver \
#     libXtst pango at-spi2-atk libXt xorg-x11-server-Xvfb \
#     xorg-x11-xauth dbus-glib nss mesa-libgbm jq unzip && \
#     dnf clean all

# # 3. Install Chrome for Testing and ChromeDriver (pinned to matching versions)
# RUN curl -Lo "/tmp/chromedriver-linux64.zip" "https://storage.googleapis.com/chrome-for-testing-public/122.0.6261.94/linux64/chromedriver-linux64.zip" && \
#     curl -Lo "/tmp/chrome-linux64.zip" "https://storage.googleapis.com/chrome-for-testing-public/122.0.6261.94/linux64/chrome-linux64.zip" && \
#     unzip /tmp/chromedriver-linux64.zip -d /opt/ && \
#     unzip /tmp/chrome-linux64.zip -d /opt/ && \
#     rm /tmp/*.zip

# # 4. Set Environment Variables for Selenium
# ENV CHROME_BIN=/opt/chrome-linux64/chrome
# ENV CHROMEDRIVER_BIN=/opt/chromedriver-linux64/chromedriver

# # 5. Copy project files
# COPY . ${LAMBDA_TASK_ROOT}

# # 6. Install Python dependencies
# # selenium==4.18.1 is pinned in requirements.txt
# # geopy is also pinned there — no separate install needed
# RUN pip install --upgrade pip
# RUN pip install --no-cache-dir -r requirements.txt

# # 7. Set the entry point to the Lambda handler
# CMD [ "run_pipeline.handler" ]