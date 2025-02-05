FROM node:18-slim

RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    procps \
    chromium \
    chromium-sandbox

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

ENV CHROME_PATH=/usr/bin/chromium
ENV PORT=7860

EXPOSE 7860

CMD ["npm", "start"]